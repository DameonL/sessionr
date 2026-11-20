using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Functions;
using SessionApp.Api.Models;

namespace SessionApp.Api.Services;

/// <summary>
/// Raw setting entry from adactio/TheSession-data's <c>json/tunes.json</c>.
/// Every field in that dump is serialized as a JSON string.
/// </summary>
public sealed record TheSessionBulkSettingRecord(
    [property: JsonPropertyName("tune_id")] string? TuneId,
    [property: JsonPropertyName("setting_id")] string? SettingId,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("type")] string? Type,
    [property: JsonPropertyName("meter")] string? Meter,
    [property: JsonPropertyName("mode")] string? Mode,
    [property: JsonPropertyName("abc")] string? Abc,
    [property: JsonPropertyName("date")] string? Date,
    [property: JsonPropertyName("username")] string? Username,
    [property: JsonPropertyName("composer")] string? Composer);

public sealed record NormalizedTheSessionSetting(
    int SettingId,
    string Key,
    TuneType TuneType,
    string SubmitterName,
    string NormalizedBody,
    string FullAbc);

public sealed record TheSessionTuneGroup(
    int TuneId,
    string Title,
    TuneType TuneType,
    string Key,
    string MasterAbcText,
    int CanonicalSettingId,
    IReadOnlyList<NormalizedTheSessionSetting> Settings);

/// <summary>
/// Downloads, parses, deduplicates, and caches <c>adactio/TheSession-data/json/tunes.json</c>
/// in memory so chunked migration batches don't re-fetch a ~23 MB JSON file on every request.
/// Registered as a singleton alongside <see cref="TuneHeuristics"/>.
/// </summary>
public class TheSessionDatasetCache(IHttpClientFactory httpClientFactory)
{
    public const string DefaultSourceUrl =
        "https://raw.githubusercontent.com/adactio/TheSession-data/main/json/tunes.json";

    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(60);
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly SemaphoreSlim _loadLock = new(1, 1);
    private IReadOnlyList<TheSessionTuneGroup>? _cachedGroups;
    private DateTime _loadedAt = DateTime.MinValue;

    private readonly SemaphoreSlim _unlinkedLock = new(1, 1);
    private Dictionary<(string TitleLower, string KeyLower), Guid>? _unlinkedByTitleKey;
    private DateTime _unlinkedLoadedAt = DateTime.MinValue;

    public async Task<IReadOnlyList<TheSessionTuneGroup>> GetOrLoadAsync(
        bool forceRefresh = false,
        string? sourceUrl = null,
        CancellationToken ct = default)
    {
        if (!forceRefresh && _cachedGroups is not null && DateTime.UtcNow - _loadedAt < CacheTtl)
        {
            return _cachedGroups;
        }

        await _loadLock.WaitAsync(ct);
        try
        {
            if (!forceRefresh && _cachedGroups is not null && DateTime.UtcNow - _loadedAt < CacheTtl)
            {
                return _cachedGroups;
            }

            using var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(120);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("SessionApp/0.1 (trad repertoire manager)");

            var url = string.IsNullOrWhiteSpace(sourceUrl) ? DefaultSourceUrl : sourceUrl;
            var records = await client.GetFromJsonAsync<List<TheSessionBulkSettingRecord>>(url, JsonOptions, ct) ?? [];

            _cachedGroups = TheSessionDataTransformer.BuildTuneGroups(records);
            _loadedAt = DateTime.UtcNow;
            return _cachedGroups;
        }
        finally
        {
            _loadLock.Release();
        }
    }

    /// <summary>
    /// Caches a lightweight (TitleLower, KeyLower) -> TuneId lookup for tunes with TheSessionId == null
    /// so chunked migration batches do not re-scan every unlinked Tune document on each 50-tune slice.
    /// </summary>
    public async Task<Dictionary<(string TitleLower, string KeyLower), Guid>> GetOrLoadUnlinkedTitleKeysAsync(
        AppDbContext db,
        bool forceRefresh = false,
        CancellationToken ct = default)
    {
        if (!forceRefresh && _unlinkedByTitleKey is not null && DateTime.UtcNow - _unlinkedLoadedAt < CacheTtl)
        {
            return _unlinkedByTitleKey;
        }

        await _unlinkedLock.WaitAsync(ct);
        try
        {
            if (!forceRefresh && _unlinkedByTitleKey is not null && DateTime.UtcNow - _unlinkedLoadedAt < CacheTtl)
            {
                return _unlinkedByTitleKey;
            }

            var unlinked = await db.Tunes
                .AsNoTracking()
                .Where(t => t.TheSessionId == null)
                .Select(t => new { t.TuneId, t.Title, t.Key })
                .ToListAsync(ct);

            var map = new Dictionary<(string TitleLower, string KeyLower), Guid>();
            foreach (var t in unlinked)
            {
                var key = TheSessionDataMigrationService.MakeTitleKey(
                    TheSessionDataTransformer.NormalizeTitle(t.Title), t.Key);
                map.TryAdd(key, t.TuneId);
            }

            _unlinkedByTitleKey = map;
            _unlinkedLoadedAt = DateTime.UtcNow;
            return _unlinkedByTitleKey;
        }
        finally
        {
            _unlinkedLock.Release();
        }
    }

    public void RemoveUnlinkedEntry((string TitleLower, string KeyLower) key)
    {
        _unlinkedByTitleKey?.Remove(key);
    }
}

/// <summary>
/// Pure transformations from <c>adactio/TheSession-data</c> bulk dump records into SessionApp's
/// canonical tune title, key, type, ABC headers, and grouped setting structures.
/// </summary>
public static partial class TheSessionDataTransformer
{
    private static readonly string[] TrailingArticles = ["The", "A", "An"];

    [GeneratedRegex(@"\s+")]
    private static partial Regex MultiSpaceRe();

    /// <summary>
    /// Converts trailing-article titles from <c>tunes.json</c> (e.g. "Silver Spear, The") into
    /// leading-article form ("The Silver Spear"), matching <see cref="TitleSort"/> and the REST API.
    /// </summary>
    public static string NormalizeTitle(string? rawTitle)
    {
        if (string.IsNullOrWhiteSpace(rawTitle))
        {
            return string.Empty;
        }

        var normalized = MultiSpaceRe().Replace(rawTitle.Trim(), " ");
        foreach (var article in TrailingArticles)
        {
            var suffix = $", {article}";
            if (normalized.EndsWith(suffix, StringComparison.OrdinalIgnoreCase) && normalized.Length > suffix.Length)
            {
                var head = normalized[..^suffix.Length].TrimEnd();
                if (head.Length > 0)
                {
                    normalized = $"{article} {head}";
                }
                break;
            }
        }
        return normalized;
    }

    /// <summary>
    /// Normalizes line endings in <c>tunes.json</c> ABC bodies without replacing <c>!</c>:
    /// unlike thesession.org's REST API, the bulk dump already uses CRLF for line breaks and
    /// uses <c>!</c> solely for ABC decorations such as <c>!slide!</c>.
    /// </summary>
    public static string NormalizeDumpAbcBody(string? rawAbc)
    {
        if (string.IsNullOrWhiteSpace(rawAbc))
        {
            return string.Empty;
        }
        return rawAbc.Replace("\r\n", "\n").Replace("\r", "\n").Trim();
    }

    /// <summary>
    /// Extracts and normalizes the ABC body below the header block so settings created earlier
    /// without <c>TheSessionSettingId</c> can still be matched against bulk dump entries even if
    /// synthetic headers differ.
    /// </summary>
    public static string ExtractComparableAbcBody(string? abcText)
    {
        if (string.IsNullOrWhiteSpace(abcText))
        {
            return string.Empty;
        }

        var normalized = abcText.Replace("\r\n", "\n").Replace("\r", "\n").Trim();
        var lines = normalized.Split('\n');

        // Header block ends at the first K: line when headers are present.
        var bodyStart = 0;
        for (var i = 0; i < lines.Length; i++)
        {
            var trimmed = lines[i].Trim();
            if (trimmed.StartsWith("K:", StringComparison.OrdinalIgnoreCase))
            {
                bodyStart = i + 1;
                break;
            }
        }

        var bodyLines = lines
            .Skip(bodyStart)
            .Select(l => l.Trim())
            .Where(l => l.Length > 0);
        return string.Join('\n', bodyLines);
    }

    /// <summary>
    /// Deduplicates raw rows by <c>setting_id</c> (the dump contains occasional duplicate rows),
    /// transforms each setting, and groups them by <c>tune_id</c> ascending with settings ordered by
    /// <c>setting_id</c> ascending (so the canonical first setting comes first).
    /// </summary>
    public static IReadOnlyList<TheSessionTuneGroup> BuildTuneGroups(IEnumerable<TheSessionBulkSettingRecord> records)
    {
        var seenSettingIds = new HashSet<int>();
        var byTuneId = new Dictionary<int, (string Title, List<NormalizedTheSessionSetting> Settings)>();

        foreach (var record in records)
        {
            if (!int.TryParse(record.TuneId, out var tuneId) || tuneId <= 0) continue;
            if (!int.TryParse(record.SettingId, out var settingId) || settingId <= 0) continue;

            var title = NormalizeTitle(record.Name);
            var body = NormalizeDumpAbcBody(record.Abc);
            if (string.IsNullOrWhiteSpace(title) || string.IsNullOrWhiteSpace(body)) continue;

            if (!seenSettingIds.Add(settingId)) continue;

            var key = TheSessionImportService.NormalizeKey(record.Mode);
            var (tuneType, meter) = TheSessionImportService.MapTypeAndMeter(record.Type, record.Meter);
            var rhythm = TuneHeuristics.FormatRhythmHeader(tuneType, record.Type);
            var fullAbc = TheSessionImportService.FormatAbcDocument(title, rhythm, meter, key, body, record.Composer);
            var submitter = string.IsNullOrWhiteSpace(record.Username) ? "thesession.org" : record.Username.Trim();

            var normalizedSetting = new NormalizedTheSessionSetting(
                settingId,
                key,
                tuneType,
                submitter,
                ExtractComparableAbcBody(body),
                fullAbc);

            if (!byTuneId.TryGetValue(tuneId, out var entry))
            {
                entry = (title, []);
                byTuneId[tuneId] = entry;
            }
            entry.Settings.Add(normalizedSetting);
        }

        var groups = new List<TheSessionTuneGroup>(byTuneId.Count);
        foreach (var (tuneId, (title, settings)) in byTuneId.OrderBy(kv => kv.Key))
        {
            settings.Sort((a, b) => a.SettingId.CompareTo(b.SettingId));
            var canonical = settings[0];
            groups.Add(new TheSessionTuneGroup(
                tuneId,
                title,
                canonical.TuneType,
                canonical.Key,
                canonical.FullAbc,
                canonical.SettingId,
                settings));
        }

        return groups;
    }
}

/// <summary>
/// Executes chunked, idempotent bulk migration batches from <see cref="TheSessionDatasetCache"/>
/// into <see cref="AppDbContext"/>, preserving existing tunes and avoiding duplicates.
/// </summary>
public class TheSessionDataMigrationService(
    AppDbContext db,
    TheSessionDatasetCache datasetCache,
    TuneHeuristics heuristics)
{
    public const int MaxBatchSize = 200;
    public const string MigrationReviewerName = "TheSessionMigration";

    public Task<MigrateTheSessionBatchResult> MigrateBatchAsync(
        MigrateTheSessionRequest request,
        CancellationToken ct = default)
        => MigrateBatchAsync(request, sourceUrl: null, ct);

    internal async Task<MigrateTheSessionBatchResult> MigrateBatchAsync(
        MigrateTheSessionRequest request,
        string? sourceUrl,
        CancellationToken ct = default)
    {
        var batchSize = Math.Clamp(request.BatchSize, 1, MaxBatchSize);
        var groups = await datasetCache.GetOrLoadAsync(request.RefreshDataset, sourceUrl, ct);

        var slice = groups
            .Where(g => g.TuneId > request.AfterTuneId)
            .Take(batchSize)
            .ToList();

        var nextAfterTuneId = slice.Count > 0 ? slice[^1].TuneId : request.AfterTuneId;
        var remainingTunes = slice.Count == 0 ? 0 : groups.Count(g => g.TuneId > nextAfterTuneId);
        var hasMore = remainingTunes > 0;

        if (slice.Count == 0)
        {
            return new MigrateTheSessionBatchResult(
                groups.Count, 0, 0, nextAfterTuneId, false, 0, 0, 0, 0, 0, []);
        }

        var (bySessionId, unlinkedByTitleKey) = await LoadExistingMatchesForSliceAsync(
            slice, request.DryRun, request.RefreshDataset, ct);

        // First pass: resolve which tunes in this slice already exist (by TheSessionId or fallback Title+Key).
        var matchedByTuneGroupId = new Dictionary<int, Tune>();
        var tunesSkippedExisting = 0;
        var tunesBackfilledId = 0;

        foreach (var group in slice)
        {
            if (bySessionId.TryGetValue(group.TuneId, out var existing))
            {
                matchedByTuneGroupId[group.TuneId] = existing;
                tunesSkippedExisting++;
                continue;
            }

            var lookupKey = MakeTitleKey(group.Title, group.Key);
            if (unlinkedByTitleKey.TryGetValue(lookupKey, out var unlinked))
            {
                // Claim the unlinked tune so no subsequent tune in this batch can match the same row.
                unlinkedByTitleKey.Remove(lookupKey);
                if (!request.DryRun)
                {
                    unlinked.TheSessionId = group.TuneId;
                    datasetCache.RemoveUnlinkedEntry(lookupKey);
                }
                matchedByTuneGroupId[group.TuneId] = unlinked;
                tunesSkippedExisting++;
                tunesBackfilledId++;
            }
        }

        // Load existing settings only for the matched tunes in this batch.
        var settingsByTuneGuid = new Dictionary<Guid, List<TuneSetting>>();
        if (request.IncludeMissingSettingsForExistingTunes && matchedByTuneGroupId.Count > 0)
        {
            var matchedTuneGuids = matchedByTuneGroupId.Values.Select(t => t.TuneId).Distinct().ToList();
            var existingSettingsQuery = db.TuneSettings.Where(s => matchedTuneGuids.Contains(s.TuneId));
            if (request.DryRun)
            {
                existingSettingsQuery = existingSettingsQuery.AsNoTracking();
            }
            var existingSettings = await existingSettingsQuery.ToListAsync(ct);
            foreach (var s in existingSettings)
            {
                if (!settingsByTuneGuid.TryGetValue(s.TuneId, out var list))
                {
                    list = [];
                    settingsByTuneGuid[s.TuneId] = list;
                }
                list.Add(s);
            }
        }

        var tunesCreated = 0;
        var settingsCreated = 0;
        var settingsSkipped = 0;
        var warnings = new List<string>();
        var now = DateTime.UtcNow;

        foreach (var group in slice)
        {
            if (matchedByTuneGroupId.TryGetValue(group.TuneId, out var existingTune))
            {
                var (added, skipped) = MergeMissingSettingsForExistingTune(
                    existingTune,
                    group,
                    settingsByTuneGuid.GetValueOrDefault(existingTune.TuneId),
                    request.IncludeMissingSettingsForExistingTunes,
                    request.DryRun);
                settingsCreated += added;
                settingsSkipped += skipped;
                continue;
            }

            CreateNewTuneWithSettings(group, now, request.DryRun);
            tunesCreated++;
            settingsCreated += group.Settings.Count;
        }

        if (!request.DryRun)
        {
            if (db.ChangeTracker.HasChanges())
            {
                await db.SaveChangesAsync(ct);
            }

            if (tunesCreated > 0)
            {
                await LibraryStatsSupport.IncrementTuneCountAsync(db, tunesCreated);
            }
            else if (settingsCreated > 0)
            {
                await LibraryStatsSupport.MarkTunesChangedAsync(db);
            }
        }

        return new MigrateTheSessionBatchResult(
            groups.Count,
            slice.Count,
            remainingTunes,
            nextAfterTuneId,
            hasMore,
            tunesCreated,
            tunesSkippedExisting,
            tunesBackfilledId,
            settingsCreated,
            settingsSkipped,
            warnings);
    }

    private async Task<(Dictionary<int, Tune> BySessionId, Dictionary<(string TitleLower, string KeyLower), Tune> UnlinkedByTitleKey)>
        LoadExistingMatchesForSliceAsync(List<TheSessionTuneGroup> slice, bool dryRun, bool refreshDataset, CancellationToken ct)
    {
        var batchNullableIds = slice.Select(g => (int?)g.TuneId).ToList();

        var matchedQuery = db.Tunes.Where(t => batchNullableIds.Contains(t.TheSessionId));
        if (dryRun)
        {
            matchedQuery = matchedQuery.AsNoTracking();
        }

        var matchedList = await matchedQuery.ToListAsync(ct);

        var bySessionId = new Dictionary<int, Tune>();
        foreach (var t in matchedList)
        {
            if (t.TheSessionId.HasValue)
            {
                bySessionId.TryAdd(t.TheSessionId.Value, t);
            }
        }

        var cachedUnlinkedMap = await datasetCache.GetOrLoadUnlinkedTitleKeysAsync(db, refreshDataset, ct);
        var candidateTuneIds = new List<Guid>();
        foreach (var group in slice)
        {
            if (bySessionId.ContainsKey(group.TuneId))
            {
                continue;
            }
            var lookupKey = MakeTitleKey(group.Title, group.Key);
            if (cachedUnlinkedMap.TryGetValue(lookupKey, out var tuneId))
            {
                candidateTuneIds.Add(tuneId);
            }
        }

        var unlinkedByTitleKey = new Dictionary<(string TitleLower, string KeyLower), Tune>();
        if (candidateTuneIds.Count > 0)
        {
            var distinctIds = candidateTuneIds.Distinct().ToList();
            var unlinkedQuery = db.Tunes.Where(t => distinctIds.Contains(t.TuneId) && t.TheSessionId == null);
            if (dryRun)
            {
                unlinkedQuery = unlinkedQuery.AsNoTracking();
            }
            var unlinkedList = await unlinkedQuery.ToListAsync(ct);
            foreach (var t in unlinkedList)
            {
                var key = MakeTitleKey(TheSessionDataTransformer.NormalizeTitle(t.Title), t.Key);
                unlinkedByTitleKey.TryAdd(key, t);
            }
        }

        return (bySessionId, unlinkedByTitleKey);
    }

    private (int Added, int Skipped) MergeMissingSettingsForExistingTune(
        Tune existingTune,
        TheSessionTuneGroup group,
        List<TuneSetting>? existingSettings,
        bool includeMissingSettings,
        bool dryRun)
    {
        if (!includeMissingSettings)
        {
            return (0, group.Settings.Count);
        }

        var existingList = existingSettings ?? [];
        var existingSessionSettingIds = existingList
            .Where(s => s.TheSessionSettingId.HasValue)
            .Select(s => s.TheSessionSettingId!.Value)
            .ToHashSet();

        var unlinkedByBody = new Dictionary<string, TuneSetting>(StringComparer.Ordinal);
        TuneSetting? unlinkedCanonicalSystemSetting = null;
        foreach (var s in existingList.Where(s => !s.TheSessionSettingId.HasValue))
        {
            var body = TheSessionDataTransformer.ExtractComparableAbcBody(s.AbcText);
            if (body.Length > 0)
            {
                unlinkedByBody.TryAdd(body, s);
            }

            if (unlinkedCanonicalSystemSetting is null
                && string.Equals(s.SubmitterName, "System", StringComparison.OrdinalIgnoreCase)
                && string.Equals(s.Key?.Trim(), group.Key, StringComparison.OrdinalIgnoreCase))
            {
                unlinkedCanonicalSystemSetting = s;
            }
        }

        var added = 0;
        var skipped = 0;

        foreach (var setting in group.Settings)
        {
            if (existingSessionSettingIds.Contains(setting.SettingId))
            {
                skipped++;
                continue;
            }

            if (setting.NormalizedBody.Length > 0 && unlinkedByBody.TryGetValue(setting.NormalizedBody, out var bodyMatch))
            {
                if (!dryRun && !bodyMatch.TheSessionSettingId.HasValue)
                {
                    bodyMatch.TheSessionSettingId = setting.SettingId;
                }
                existingSessionSettingIds.Add(setting.SettingId);
                skipped++;
                continue;
            }

            // A tune previously imported via the REST API or seeded in dev has a "System" setting
            // whose ABC line breaks/ornaments may differ slightly from tunes.json; treat it as the
            // canonical setting rather than creating a duplicate first setting.
            if (setting.SettingId == group.CanonicalSettingId && unlinkedCanonicalSystemSetting is not null)
            {
                if (!dryRun && !unlinkedCanonicalSystemSetting.TheSessionSettingId.HasValue)
                {
                    unlinkedCanonicalSystemSetting.TheSessionSettingId = setting.SettingId;
                }
                unlinkedCanonicalSystemSetting = null;
                existingSessionSettingIds.Add(setting.SettingId);
                skipped++;
                continue;
            }

            if (!dryRun)
            {
                var entity = new TuneSetting
                {
                    TuneId = existingTune.TuneId,
                    TheSessionSettingId = setting.SettingId,
                    Key = setting.Key,
                    AbcText = setting.FullAbc,
                    SubmitterName = setting.SubmitterName,
                    VoteScore = 1,
                };
                heuristics.ApplyFingerprint(entity, existingTune.TuneType);
                db.TuneSettings.Add(entity);
            }

            existingSessionSettingIds.Add(setting.SettingId);
            added++;
        }

        return (added, skipped);
    }

    private void CreateNewTuneWithSettings(TheSessionTuneGroup group, DateTime reviewedAt, bool dryRun)
    {
        if (dryRun)
        {
            return;
        }

        var tune = new Tune
        {
            Title = group.Title,
            TheSessionId = group.TuneId,
            TuneType = group.TuneType,
            Key = group.Key,
            MasterAbcText = group.MasterAbcText,
            IsReviewed = true,
            ReviewedAt = reviewedAt,
            ReviewedBy = MigrationReviewerName,
        };
        heuristics.Apply(tune);
        db.Tunes.Add(tune);

        for (var i = 0; i < group.Settings.Count; i++)
        {
            var s = group.Settings[i];
            var settingEntity = new TuneSetting
            {
                TuneId = tune.TuneId,
                TheSessionSettingId = s.SettingId,
                Key = s.Key,
                AbcText = s.FullAbc,
                SubmitterName = s.SubmitterName,
                VoteScore = i == 0 ? 3 : 1,
            };
            heuristics.ApplyFingerprint(settingEntity, tune.TuneType);
            db.TuneSettings.Add(settingEntity);
        }
    }

    internal static (string TitleLower, string KeyLower) MakeTitleKey(string? title, string? key) =>
        ((title ?? string.Empty).Trim().ToLowerInvariant(), (key ?? string.Empty).Trim().ToLowerInvariant());
}
