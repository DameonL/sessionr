using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

/// <summary>Keeps the cached LibraryStats.TuneCount in sync with tune creation/deletion.</summary>
public static class LibraryStatsSupport
{
    public static async Task IncrementTuneCountAsync(AppDbContext db)
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

    public static async Task DecrementTuneCountAsync(AppDbContext db)
    {
        var stats = await db.LibraryStats.FirstOrDefaultAsync(s => s.LibraryStatsId == Models.LibraryStats.SingletonId);
        if (stats is null)
        {
            return;
        }
        stats.TuneCount = stats.TuneCount > 0 ? stats.TuneCount - 1 : 0;
        await db.SaveChangesAsync();
    }
}
