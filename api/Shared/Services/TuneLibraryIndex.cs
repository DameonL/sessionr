using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SessionApp.Api.Data;
using SessionApp.Api.Functions;
using SessionApp.Api.Models;

namespace SessionApp.Api.Services;

/// <summary>
/// Throttled reader for <see cref="LibraryStats.TunesChangedAt"/>, shared by the in-memory
/// Public API indexes so writes in the Private process invalidate cached snapshots within
/// <see cref="StampCheckInterval"/> without querying <c>LibraryStats</c> on every request.
/// </summary>
internal sealed class LibraryChangeStampChecker(IServiceScopeFactory scopeFactory, string callerName)
{
    private static readonly TimeSpan StampCheckInterval = TimeSpan.FromSeconds(30);
    private DateTime _lastStampCheck = DateTime.MinValue;

    public async Task<bool> HasChangedSinceAsync(DateTime builtAt, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        if (now - _lastStampCheck < StampCheckInterval)
        {
            return false;
        }
        _lastStampCheck = now;

        try
        {
            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var stats = await db.LibraryStats.AsNoTracking()
                .FirstOrDefaultAsync(s => s.LibraryStatsId == LibraryStats.SingletonId, ct);
            return stats?.TunesChangedAt is { } changedAt && changedAt > builtAt;
        }
        catch (Exception ex)
        {
            // Never let the freshness check break reads: a failed read falls back to the TTL.
            Console.Error.WriteLine($"[{callerName}] couldn't read the tune-change stamp (safe to ignore):\n{ex}");
            return false;
        }
    }
}

/// <summary>
/// In-memory catalog of every tune's browse/search metadata and aliases, used by
/// <c>GET /api/tunes</c> so <c>popular</c>, <c>newest</c>, <c>alphabetical</c>, and filtered
/// searches run in memory without cross-partition Cosmos <c>ORDER BY</c> / <c>OFFSET</c>
/// scans over 23k+ self-partitioned documents.
/// </summary>
public class TuneLibraryIndex(IServiceScopeFactory scopeFactory)
{
    private sealed record IndexEntry(
        Guid TuneId,
        string Title,
        string TitleSortKey,
        TuneType TuneType,
        string TuneTypeName,
        string Key,
        int RepertoireCount,
        int Difficulty,
        DateTime CreatedAt,
        string[] Aliases);

    private sealed record Snapshot(
        IReadOnlyList<IndexEntry> ByTitle,
        IReadOnlyList<IndexEntry> ByPopular,
        IReadOnlyList<IndexEntry> ByNewest,
        DateTime BuiltAt);

    // Longer background TTL for RepertoireCount updates because AddToRepertoire/RemoveRepertoireItem
    // deliberately do not stamp LibraryStats.TunesChangedAt; structural tune edits still invalidate
    // via LibraryStats.TunesChangedAt within StampCheckInterval.
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromHours(6);
    private static readonly TimeSpan RebuildTimeout = TimeSpan.FromSeconds(120);

    private readonly object _rebuildGate = new();
    private Task? _inflightRebuild;
    private readonly LibraryChangeStampChecker _stampChecker = new(scopeFactory, nameof(TuneLibraryIndex));
    private volatile Snapshot _snapshot = new([], [], [], DateTime.MinValue);

    /// <summary>Rebuilds the catalog index now, regardless of the TTL.</summary>
    public Task ForceRefreshAsync(CancellationToken ct = default) => RebuildAsync(ct, force: true);

    public async Task<PagedResult<TuneDto>> SearchAsync(
        string? search,
        string? type,
        string? key,
        string? sort,
        int page,
        int pageSize,
        CancellationToken ct = default)
    {
        await EnsureFreshAsync(ct);
        var snapshot = _snapshot;

        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 100) pageSize = 100;

        var trimmedSearch = search?.Trim() ?? string.Empty;
        var trimmedKey = key?.Trim() ?? string.Empty;
        var hasTypeFilter = Enum.TryParse<TuneType>(type?.Trim(), ignoreCase: true, out var tuneType);
        var hasSearch = trimmedSearch.Length > 0;
        var hasKey = trimmedKey.Length > 0;

        var source = (sort?.Trim().ToLowerInvariant()) switch
        {
            "popular" => snapshot.ByPopular,
            "newest" => snapshot.ByNewest,
            _ => snapshot.ByTitle,
        };

        var skip = (page - 1) * pageSize;

        if (!hasSearch && !hasTypeFilter && !hasKey)
        {
            var totalCount = source.Count;
            var items = new List<TuneDto>(Math.Min(pageSize, Math.Max(0, totalCount - skip)));
            var end = Math.Min(totalCount, skip + pageSize);
            for (var i = skip; i < end; i++)
            {
                items.Add(ToDto(source[i]));
            }
            return new PagedResult<TuneDto>(items, totalCount, page, pageSize, (page * pageSize) < totalCount);
        }

        var filteredItems = new List<TuneDto>(pageSize);
        var matchCount = 0;

        for (var i = 0; i < source.Count; i++)
        {
            var entry = source[i];
            if (hasTypeFilter && entry.TuneType != tuneType) continue;
            if (hasKey && !string.Equals(entry.Key, trimmedKey, StringComparison.Ordinal)) continue;
            if (hasSearch && !MatchesSearch(entry, trimmedSearch)) continue;

            if (matchCount >= skip && filteredItems.Count < pageSize)
            {
                filteredItems.Add(ToDto(entry));
            }
            matchCount++;
        }

        return new PagedResult<TuneDto>(filteredItems, matchCount, page, pageSize, (page * pageSize) < matchCount);
    }

    private static bool MatchesSearch(IndexEntry entry, string search)
    {
        if (entry.Title.Contains(search, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        foreach (var alias in entry.Aliases)
        {
            if (alias.Contains(search, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }

    private static TuneDto ToDto(IndexEntry entry) =>
        new(entry.TuneId, entry.Title, entry.TuneTypeName, entry.Key, entry.RepertoireCount, entry.Difficulty);

    private async Task EnsureFreshAsync(CancellationToken ct)
    {
        var snapshot = _snapshot;
        if (snapshot.BuiltAt == DateTime.MinValue || DateTime.UtcNow - snapshot.BuiltAt >= RefreshInterval)
        {
            await RebuildAsync(ct, force: false);
            return;
        }

        if (await _stampChecker.HasChangedSinceAsync(snapshot.BuiltAt, ct))
        {
            await RebuildAsync(ct, force: true);
        }
    }

    /// <summary>
    /// Shares one in-flight rebuild task across concurrent callers and decouples the DB queries
    /// from any single caller's <see cref="CancellationToken"/> so a client timeout cannot abort
    /// a cold rebuild mid-flight and strand subsequent requests.
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

                rebuildTask = Task.Run(ExecuteRebuildAndClearAsync);
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

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // Project only browse/search metadata and cast numeric/date fields added after initial
        // launch to nullable so Cosmos's projection shaper doesn't throw "Nullable object must
        // have a value" on legacy schemaless documents while skipping MasterAbcText and fingerprints.
        var rawTunes = await db.Tunes
            .AsNoTracking()
            .Select(t => new
            {
                t.TuneId,
                t.Title,
                t.TuneType,
                t.Key,
                RepertoireCount = (int?)t.RepertoireCount,
                Difficulty = (int?)t.Difficulty,
                CreatedAt = (DateTime?)t.CreatedAt,
            })
            .ToListAsync(rebuildCt);

        var rawAliases = await db.TuneAliases
            .AsNoTracking()
            .Select(a => new { a.TuneId, a.Name })
            .ToListAsync(rebuildCt);

        var aliasesByTuneId = new Dictionary<Guid, List<string>>();
        foreach (var a in rawAliases)
        {
            if (string.IsNullOrWhiteSpace(a.Name)) continue;
            if (!aliasesByTuneId.TryGetValue(a.TuneId, out var list))
            {
                list = [];
                aliasesByTuneId[a.TuneId] = list;
            }
            list.Add(a.Name);
        }

        var entries = new List<IndexEntry>(rawTunes.Count);
        foreach (var t in rawTunes)
        {
            var title = t.Title ?? string.Empty;
            var aliases = aliasesByTuneId.TryGetValue(t.TuneId, out var aliasList)
                ? aliasList.ToArray()
                : [];

            entries.Add(new IndexEntry(
                t.TuneId,
                title,
                TitleSort.Key(title),
                t.TuneType,
                t.TuneType.ToString(),
                t.Key ?? string.Empty,
                t.RepertoireCount ?? 0,
                t.Difficulty ?? 0,
                t.CreatedAt ?? DateTime.MinValue,
                aliases));
        }

        var byTitle = entries
            .OrderBy(e => e.TitleSortKey, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var byPopular = entries
            .OrderByDescending(e => e.RepertoireCount)
            .ThenBy(e => e.TitleSortKey, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var byNewest = entries
            .OrderByDescending(e => e.CreatedAt)
            .ThenBy(e => e.TitleSortKey, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        _snapshot = new Snapshot(byTitle, byPopular, byNewest, DateTime.UtcNow);
    }
}
