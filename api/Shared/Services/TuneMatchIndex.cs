using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Services;

public record TuneMatchCandidateDto(
    Guid TuneId, string Title, string TuneType, string Key,
    int Difficulty, double Confidence, Guid? MatchedTuneSettingId);

/// <summary>
/// In-memory index of every tune's (and tune setting's) melodic fingerprint, used to
/// identify a live-played snippet against the full tune library without a per-request
/// database round trip. Built lazily on first use per Functions instance and rebuilt on
/// a TTL, mirroring the sliding in-memory cache pattern already used elsewhere in this
/// app (e.g. AzureDirectoryAuthorization's static MemoryCache) rather than adding a
/// shared cache dependency this repo doesn't otherwise have.
///
/// Registered as a singleton, so it can't constructor-inject the scoped AppDbContext —
/// it creates its own short-lived scope to query when rebuilding.
/// </summary>
public class TuneMatchIndex(IServiceScopeFactory scopeFactory)
{
    private sealed record IndexEntry(
        Guid TuneId, Guid? TuneSettingId, string Title, string TuneType,
        string Key, int Difficulty, int[] Intervals, double[]? PitchClassProfile);

    /// <summary>
    /// Entries and their shingle indexes are always read and replaced together
    /// as one immutable unit so concurrent readers never see mismatched pairs.
    /// </summary>
    private sealed record Snapshot(
        IReadOnlyList<IndexEntry> Entries,
        Dictionary<long, List<int>> ShingleIndex,
        Dictionary<long, List<int>> FallbackShingleIndex,
        DateTime BuiltAt);

    private static readonly TimeSpan RefreshInterval = TimeSpan.FromHours(6);
    private static readonly TimeSpan RebuildTimeout = TimeSpan.FromSeconds(120);
    private const int ShingleLength = 5;
    private const int ShingleLengthFallback = 3;
    private const int MaxShortlist = 150;
    private const int MaxFallbackShortlist = 300;
    private const int FullSweepThreshold = 200;

    private readonly object _rebuildGate = new();
    private Task? _inflightRebuild;
    private readonly LibraryChangeStampChecker _stampChecker = new(scopeFactory, nameof(TuneMatchIndex));
    // volatile so a rebuild published on one thread is visible to readers on
    // another without them needing to take a lock.
    private volatile Snapshot _snapshot = new(
        [],
        new Dictionary<long, List<int>>(),
        new Dictionary<long, List<int>>(),
        DateTime.MinValue);

    /// <summary>Warms the index if cold or stale. Used by host startup background warmup.</summary>
    public Task WarmupAsync(CancellationToken ct = default) => EnsureFreshAsync(ct);

    /// <summary>Rebuilds the index now, regardless of the TTL. Used by the moderator refresh endpoint.</summary>
    public Task ForceRefreshAsync(CancellationToken ct = default) => RebuildAsync(ct, force: true);

    /// <param name="queryPitchClasses">
    /// The query's pitch-class profile, or null to score on melodic alignment alone. Absolute
    /// pitch is gone by the time a melody has been reduced to intervals, so this has to be
    /// passed alongside rather than derived here.
    /// </param>
    public async Task<IReadOnlyList<TuneMatchCandidateDto>> MatchAsync(
        int[] queryIntervals, int topN = 5, double[]? queryPitchClasses = null, CancellationToken ct = default)
    {
        await EnsureFreshAsync(ct);
        // Captured once so this whole request scores against one consistent
        // snapshot even if a rebuild swaps _snapshot concurrently.
        var snapshot = _snapshot;

        if (queryIntervals.Length == 0 || snapshot.Entries.Count == 0)
        {
            return [];
        }

        var shortlist = BuildShortlist(snapshot, queryIntervals, queryPitchClasses);

        var scored = shortlist
            // Tiled so a query spanning more than one pass of a short tune can align
            // end to end instead of being capped by the candidate's written length.
            .Select(entry => (entry, alignment: MelodyFingerprint.LocalAlign(
                queryIntervals, MelodyFingerprint.TileToAtLeast(entry.Intervals, queryIntervals.Length))))
            .Select(x => (x.entry, alignment: MelodyFingerprint.Confidence(x.alignment, queryIntervals.Length)))
            // Zero alignment means the query never lined up with this tune at all; pitch-class
            // colour alone must not be able to resurrect it into the results.
            .Where(x => x.alignment > 0)
            .Select(x => (x.entry, confidence: MelodyFingerprint.FusedConfidence(
                x.alignment, queryPitchClasses, x.entry.PitchClassProfile)))
            // Multiple settings (and the master) can match the same tune; keep only its best score.
            .GroupBy(x => x.entry.TuneId)
            .Select(g => g.OrderByDescending(x => x.confidence).First())
            .OrderByDescending(x => x.confidence)
            .Take(topN)
            .Select(x => new TuneMatchCandidateDto(
                x.entry.TuneId, x.entry.Title, x.entry.TuneType, x.entry.Key,
                x.entry.Difficulty, Math.Round(x.confidence, 1), x.entry.TuneSettingId))
            .ToList();

        return scored;
    }

    private static IEnumerable<IndexEntry> BuildShortlist(
        Snapshot snapshot,
        int[] queryIntervals,
        double[]? queryPitchClasses)
    {
        if (snapshot.Entries.Count <= FullSweepThreshold)
        {
            return snapshot.Entries;
        }

        if (queryIntervals.Length >= ShingleLength)
        {
            var votes = VoteByShingles(snapshot.ShingleIndex, queryIntervals, ShingleLength);
            if (votes.Count > 0)
            {
                return TopVotedEntries(snapshot.Entries, votes, MaxShortlist);
            }
        }

        if (queryIntervals.Length >= ShingleLengthFallback)
        {
            var fallbackVotes = VoteByShingles(snapshot.FallbackShingleIndex, queryIntervals, ShingleLengthFallback);
            if (fallbackVotes.Count > 0)
            {
                return TopVotedEntries(snapshot.Entries, fallbackVotes, MaxShortlist);
            }
        }

        if (queryPitchClasses is not null)
        {
            return snapshot.Entries
                .Where(e => e.PitchClassProfile is not null)
                .OrderByDescending(e => MelodyFingerprint.PitchClassSimilarity(queryPitchClasses, e.PitchClassProfile!))
                .Take(MaxFallbackShortlist);
        }

        return snapshot.Entries.Take(MaxFallbackShortlist);
    }

    private static Dictionary<int, int> VoteByShingles(
        Dictionary<long, List<int>> index,
        int[] queryIntervals,
        int shingleLength)
    {
        var votes = new Dictionary<int, int>();
        foreach (var hash in MelodyFingerprint.Shingles(queryIntervals, shingleLength))
        {
            if (!index.TryGetValue(hash, out var indices)) continue;
            foreach (var idx in indices)
            {
                votes[idx] = votes.GetValueOrDefault(idx) + 1;
            }
        }
        return votes;
    }

    private static IEnumerable<IndexEntry> TopVotedEntries(
        IReadOnlyList<IndexEntry> entries,
        Dictionary<int, int> votes,
        int limit) =>
        votes
            .OrderByDescending(kv => kv.Value)
            .Take(limit)
            .Select(kv => entries[kv.Key]);

    private async Task EnsureFreshAsync(CancellationToken ct)
    {
        var snapshot = _snapshot;
        if (snapshot.BuiltAt == DateTime.MinValue || DateTime.UtcNow - snapshot.BuiltAt >= RefreshInterval)
        {
            await RebuildAsync(ct, force: false);
            return;
        }

        // Within the TTL the snapshot is presumed good, but an import may have landed since it
        // was built. Writes happen in the Private Functions process and this index lives in the
        // Public one, so the writer can't invalidate us directly — it stamps LibraryStats and we
        // notice here, which is what keeps a newly imported tune from being unidentifiable for
        // the rest of the TTL without anyone having to trigger a refresh by hand.
        if (await _stampChecker.HasChangedSinceAsync(snapshot.BuiltAt, ct))
        {
            await RebuildAsync(ct, force: true);
        }
    }

    /// <summary>
    /// Shares one in-flight rebuild task across concurrent callers and decouples the DB queries
    /// from any single caller's <see cref="CancellationToken"/> so a client timeout cannot abort
    /// a cold rebuild mid-flight and strand subsequent requests with an empty snapshot.
    /// </summary>
    private async Task RebuildAsync(CancellationToken ct, bool force)
    {
        Task rebuildTask;
        lock (_rebuildGate)
        {
            if (_inflightRebuild is { IsCompleted: false } existing)
            {
                rebuildTask = existing;
            }
            else
            {
                var current = _snapshot;
                if (!force && current.BuiltAt != DateTime.MinValue && DateTime.UtcNow - current.BuiltAt < RefreshInterval)
                {
                    return;
                }

                rebuildTask = ExecuteRebuildAndClearAsync();
                _inflightRebuild = rebuildTask;
            }
        }

        await rebuildTask.WaitAsync(ct);
    }

    private async Task ExecuteRebuildAndClearAsync()
    {
        try
        {
            await ExecuteRebuildAsync();
        }
        finally
        {
            lock (_rebuildGate)
            {
                _inflightRebuild = null;
            }
        }
    }

    private async Task ExecuteRebuildAsync()
    {
        using var timeoutCts = new CancellationTokenSource(RebuildTimeout);
        var rebuildCt = timeoutCts.Token;

        // Project only the fingerprint/metadata fields needed for matching and cast Difficulty to
        // nullable so Cosmos's projection shaper doesn't throw on legacy documents while skipping
        // MasterAbcText and AbcText. Load Tunes and TuneSettings concurrently across separate
        // scopes (EF DbContext is not thread-safe) to halve Cosmos Gateway round-trip latency.
        var tunesTask = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Tunes
                .AsNoTracking()
                .Select(t => new
                {
                    t.TuneId,
                    t.Title,
                    t.TuneType,
                    t.Key,
                    Difficulty = (int?)t.Difficulty,
                    t.FingerprintIntervals,
                    t.PitchClassProfile,
                })
                .ToListAsync(rebuildCt);
        }, rebuildCt);

        var settingsTask = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.TuneSettings
                .AsNoTracking()
                .Select(s => new
                {
                    s.TuneId,
                    s.TuneSettingId,
                    s.Key,
                    s.FingerprintIntervals,
                    s.PitchClassProfile,
                })
                .ToListAsync(rebuildCt);
        }, rebuildCt);

        await Task.WhenAll(tunesTask, settingsTask);
        var tunes = await tunesTask;
        var settings = await settingsTask;

        // Last-wins rather than ToDictionary: a duplicate TuneId across Cosmos partitions is
        // a data anomaly, not a reason to leave the whole endpoint without an index.
        var tuneById = new Dictionary<Guid, (string Title, string TuneType, int Difficulty)>(tunes.Count);
        var entries = new List<IndexEntry>(tunes.Count + settings.Count);

        foreach (var t in tunes)
        {
            var title = t.Title ?? string.Empty;
            var tuneType = t.TuneType.ToString();
            var difficulty = t.Difficulty ?? 0;
            tuneById[t.TuneId] = (title, tuneType, difficulty);

            var intervals = MelodyFingerprint.ParseIntervalString(t.FingerprintIntervals);
            if (intervals.Length == 0) continue;
            entries.Add(new IndexEntry(
                t.TuneId, null, title, tuneType,
                t.Key ?? string.Empty, difficulty, intervals,
                MelodyFingerprint.ParsePitchClassProfile(t.PitchClassProfile)));
        }

        foreach (var s in settings)
        {
            if (!tuneById.TryGetValue(s.TuneId, out var tune)) continue;
            var intervals = MelodyFingerprint.ParseIntervalString(s.FingerprintIntervals);
            if (intervals.Length == 0) continue;
            entries.Add(new IndexEntry(
                s.TuneId, s.TuneSettingId, tune.Title, tune.TuneType,
                s.Key ?? string.Empty, tune.Difficulty, intervals,
                MelodyFingerprint.ParsePitchClassProfile(s.PitchClassProfile)));
        }

        var shingleIndex = BuildShingleIndex(entries, ShingleLength);
        var fallbackShingleIndex = BuildShingleIndex(entries, ShingleLengthFallback);

        // Single atomic swap: readers always see a matched Entries/ShingleIndex pair.
        _snapshot = new Snapshot(entries, shingleIndex, fallbackShingleIndex, DateTime.UtcNow);
    }

    private static Dictionary<long, List<int>> BuildShingleIndex(
        IReadOnlyList<IndexEntry> entries,
        int shingleLength)
    {
        var index = new Dictionary<long, List<int>>();
        for (var i = 0; i < entries.Count; i++)
        {
            foreach (var hash in MelodyFingerprint.Shingles(entries[i].Intervals, shingleLength))
            {
                if (!index.TryGetValue(hash, out var list))
                {
                    list = [];
                    index[hash] = list;
                }
                list.Add(i);
            }
        }
        return index;
    }
}
