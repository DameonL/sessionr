using System;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

/// <summary>Keeps the cached LibraryStats.TuneCount in sync with tune creation/deletion.</summary>
public static class LibraryStatsSupport
{
    /// <summary>
    /// Best-effort: the tune create/delete itself has already been saved by the time either
    /// method here runs, so a failure updating this cache (e.g. the LibraryStats container
    /// isn't provisioned yet) must not surface as a failure of the actual operation. Get.cs's
    /// read side falls back to a live count when the cache is stale or unreadable.
    /// </summary>
    public static async Task IncrementTuneCountAsync(AppDbContext db)
    {
        try
        {
            var stats = await db.LibraryStats.FirstOrDefaultAsync(s => s.LibraryStatsId == Models.LibraryStats.SingletonId);
            if (stats is null)
            {
                db.LibraryStats.Add(new Models.LibraryStats
                {
                    TuneCount = await db.Tunes.CosmosCountAsync(),
                    TunesChangedAt = DateTime.UtcNow,
                });
            }
            else
            {
                stats.TuneCount++;
                stats.TunesChangedAt = DateTime.UtcNow;
            }
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[LibraryStatsSupport] couldn't increment tune count cache (safe to ignore):\n{ex}");
        }
    }

    /// <summary>
    /// Records that a tune or setting fingerprint changed, so the Public app's TuneMatchIndex
    /// rebuilds on its next request instead of serving a stale index until its TTL expires.
    /// Call after any write that adds, edits or removes a fingerprint.
    ///
    /// Best-effort like the counters above: a newly imported tune being identifiable a few
    /// minutes later is not worth failing the import over, and the index's TTL is still there
    /// as a backstop if this never lands.
    /// </summary>
    public static async Task MarkTunesChangedAsync(AppDbContext db)
    {
        try
        {
            var stats = await db.LibraryStats.FirstOrDefaultAsync(s => s.LibraryStatsId == Models.LibraryStats.SingletonId);
            if (stats is null)
            {
                db.LibraryStats.Add(new Models.LibraryStats
                {
                    TuneCount = await db.Tunes.CosmosCountAsync(),
                    TunesChangedAt = DateTime.UtcNow,
                });
            }
            else
            {
                stats.TunesChangedAt = DateTime.UtcNow;
            }
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[LibraryStatsSupport] couldn't stamp the tune-change time (safe to ignore):\n{ex}");
        }
    }

    public static async Task DecrementTuneCountAsync(AppDbContext db)
    {
        try
        {
            var stats = await db.LibraryStats.FirstOrDefaultAsync(s => s.LibraryStatsId == Models.LibraryStats.SingletonId);
            if (stats is null)
            {
                return;
            }
            stats.TuneCount = stats.TuneCount > 0 ? stats.TuneCount - 1 : 0;
            stats.TunesChangedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[LibraryStatsSupport] couldn't decrement tune count cache (safe to ignore):\n{ex}");
        }
    }
}
