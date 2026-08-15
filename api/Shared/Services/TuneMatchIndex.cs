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
        string Key, int Difficulty, int[] Intervals);

    /// <summary>
    /// Entries and their shingle index are always read and replaced together
    /// as one immutable unit. They used to be two separate fields swapped by
    /// two separate statements at the end of a rebuild — a concurrent reader
    /// landing between those two writes could see a new entry list paired
    /// with a stale shingle index (or vice versa), risking a wrong-tune match
    /// or an out-of-range lookup. Bundling them here makes that impossible:
    /// a reference write is atomic, so any reader sees either the fully-old
    /// or fully-new pair, never a mix.
    /// </summary>
    private sealed record Snapshot(IReadOnlyList<IndexEntry> Entries, Dictionary<long, List<int>> ShingleIndex, DateTime BuiltAt);

    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(30);
    private const int ShingleLength = 5;
    private const int MaxShortlist = 150;
    private const int FullSweepThreshold = 200;

    private readonly SemaphoreSlim _rebuildLock = new(1, 1);
    // volatile so a rebuild published on one thread is visible to readers on
    // another without them needing to take a lock.
    private volatile Snapshot _snapshot = new([], new Dictionary<long, List<int>>(), DateTime.MinValue);

    /// <summary>Rebuilds the index now, regardless of the TTL. Used by the moderator refresh endpoint.</summary>
    public Task ForceRefreshAsync(CancellationToken ct = default) => RebuildAsync(ct);

    public async Task<IReadOnlyList<TuneMatchCandidateDto>> MatchAsync(int[] queryIntervals, int topN = 5, CancellationToken ct = default)
    {
        await EnsureFreshAsync(ct);
        // Captured once so this whole request scores against one consistent
        // snapshot even if a rebuild swaps _snapshot concurrently.
        var snapshot = _snapshot;

        if (queryIntervals.Length == 0 || snapshot.Entries.Count == 0)
        {
            return [];
        }

        var shortlist = BuildShortlist(snapshot, queryIntervals);

        var scored = shortlist
            .Select(entry => (entry, alignment: MelodyFingerprint.LocalAlign(queryIntervals, entry.Intervals)))
            .Select(x => (x.entry, confidence: MelodyFingerprint.Confidence(x.alignment, queryIntervals.Length)))
            .Where(x => x.confidence > 0)
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

    private static IEnumerable<IndexEntry> BuildShortlist(Snapshot snapshot, int[] queryIntervals)
    {
        if (snapshot.Entries.Count <= FullSweepThreshold || queryIntervals.Length < ShingleLength)
        {
            return snapshot.Entries;
        }

        var votes = new Dictionary<int, int>();
        foreach (var hash in MelodyFingerprint.Shingles(queryIntervals, ShingleLength))
        {
            if (!snapshot.ShingleIndex.TryGetValue(hash, out var indices)) continue;
            foreach (var idx in indices)
            {
                votes[idx] = votes.GetValueOrDefault(idx) + 1;
            }
        }

        if (votes.Count == 0)
        {
            // No shingle overlap at all — fall back to a full sweep rather than
            // returning nothing (a noisy query might not share a single 5-gram).
            return snapshot.Entries;
        }

        return votes
            .OrderByDescending(kv => kv.Value)
            .Take(MaxShortlist)
            .Select(kv => snapshot.Entries[kv.Key]);
    }

    private async Task EnsureFreshAsync(CancellationToken ct)
    {
        var snapshot = _snapshot;
        if (snapshot.Entries.Count > 0 && DateTime.UtcNow - snapshot.BuiltAt < RefreshInterval)
        {
            return;
        }
        await RebuildAsync(ct);
    }

    private async Task RebuildAsync(CancellationToken ct)
    {
        await _rebuildLock.WaitAsync(ct);
        try
        {
            // Another caller may have just finished a rebuild while we waited.
            var current = _snapshot;
            if (current.Entries.Count > 0 && DateTime.UtcNow - current.BuiltAt < RefreshInterval)
            {
                return;
            }

            using var scope = scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var tunes = await db.Tunes.AsNoTracking()
                .Select(t => new { t.TuneId, t.Title, t.TuneType, t.Key, t.Difficulty, t.FingerprintIntervals })
                .ToListAsync(ct);

            var settings = await db.TuneSettings.AsNoTracking()
                .Select(s => new { s.TuneSettingId, s.TuneId, s.Key, s.FingerprintIntervals })
                .ToListAsync(ct);

            var tuneById = tunes.ToDictionary(t => t.TuneId);

            var entries = new List<IndexEntry>();

            foreach (var t in tunes)
            {
                var intervals = MelodyFingerprint.ParseIntervalString(t.FingerprintIntervals);
                if (intervals.Length == 0) continue;
                entries.Add(new IndexEntry(t.TuneId, null, t.Title, t.TuneType.ToString(), t.Key, t.Difficulty, intervals));
            }

            foreach (var s in settings)
            {
                if (!tuneById.TryGetValue(s.TuneId, out var tune)) continue;
                var intervals = MelodyFingerprint.ParseIntervalString(s.FingerprintIntervals);
                if (intervals.Length == 0) continue;
                entries.Add(new IndexEntry(s.TuneId, s.TuneSettingId, tune.Title, tune.TuneType.ToString(), s.Key, tune.Difficulty, intervals));
            }

            var shingleIndex = new Dictionary<long, List<int>>();
            for (var i = 0; i < entries.Count; i++)
            {
                foreach (var hash in MelodyFingerprint.Shingles(entries[i].Intervals, ShingleLength))
                {
                    if (!shingleIndex.TryGetValue(hash, out var list))
                    {
                        list = [];
                        shingleIndex[hash] = list;
                    }
                    list.Add(i);
                }
            }

            // Single atomic swap: readers always see a matched Entries/ShingleIndex pair.
            _snapshot = new Snapshot(entries, shingleIndex, DateTime.UtcNow);
        }
        finally
        {
            _rebuildLock.Release();
        }
    }
}
