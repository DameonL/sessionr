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
                db.LibraryStats.Add(new Models.LibraryStats { TuneCount = await db.Tunes.CosmosCountAsync() });
            }
            else
            {
                stats.TuneCount++;
            }
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[LibraryStatsSupport] couldn't increment tune count cache (safe to ignore):\n{ex}");
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
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[LibraryStatsSupport] couldn't decrement tune count cache (safe to ignore):\n{ex}");
        }
    }
}
