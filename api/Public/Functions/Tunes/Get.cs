using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions.Tunes;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/tunes?search=&amp;type=&amp;key= — search the global tune library.</summary>
    [Function("SearchTunes")]
    public async Task<IActionResult> SearchTunes(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "tunes")] HttpRequest req)
    {
        try
        {
            return await DoSearch(req);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SearchTunes ERROR]\n{ex}");
            return new ObjectResult(new { error = ex.Message, detail = ex.ToString() }) { StatusCode = 500 };
        }
    }

    private async Task<IActionResult> DoSearch(HttpRequest req)
    {
        var search = req.Query["search"].ToString().Trim();
        var type = req.Query["type"].ToString().Trim();
        var key = req.Query["key"].ToString().Trim();

        var query = db.Tunes.AsNoTracking();
        var hasFilter = false;

        if (!string.IsNullOrWhiteSpace(search))
        {
            hasFilter = true;
            var searchLower = search.ToLower();
            var matchingAliasTuneIds = await db.TuneAliases
                .AsNoTracking()
                .Where(a => a.Name.ToLower().Contains(searchLower))
                .Select(a => a.TuneId)
                .Distinct()
                .ToListAsync();

            if (matchingAliasTuneIds.Count > 0)
            {
                query = query.Where(t => t.Title.ToLower().Contains(searchLower) || matchingAliasTuneIds.Contains(t.TuneId));
            }
            else
            {
                query = query.Where(t => t.Title.ToLower().Contains(searchLower));
            }
        }
        if (Enum.TryParse<TuneType>(type, ignoreCase: true, out var tuneType))
        {
            hasFilter = true;
            query = query.Where(t => t.TuneType == tuneType);
        }
        if (!string.IsNullOrWhiteSpace(key))
        {
            hasFilter = true;
            query = query.Where(t => t.Key == key);
        }

        var sort = req.Query["sort"].ToString().ToLower().Trim();

        int.TryParse(req.Query["page"], out var page);
        if (page < 1) page = 1;

        int.TryParse(req.Query["pageSize"], out var pageSize);
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 100) pageSize = 100;

        // An unfiltered browse (the common case — Newest/Popular tabs and the default
        // library landing) always counts the whole collection, so use the maintained
        // LibraryStats cache instead of fetching every TuneId just to count them.
        // A filtered search's count depends on the filter, so it still has to be computed
        // per-request — but count before sorting: Cosmos's cross-partition query engine
        // requires the ORDER BY property to be present in the SELECT projection, and this
        // count narrows the projection down to just TuneId, so it must run against the
        // unsorted query.
        var totalCount = hasFilter
            ? await query.Select(t => t.TuneId).CosmosCountAsync()
            : await GetCachedTuneCountAsync();

        if (sort == "popular")
        {
            query = query.OrderByDescending(t => t.RepertoireCount);
        }
        else if (sort == "newest")
        {
            query = query.OrderByDescending(t => t.CreatedAt);
        }
        else
        {
            query = query.OrderBy(t => t.Title);
        }

        // Materialize full entities rather than projecting straight into TuneDto: tune documents
        // created before RepertoireCount/CreatedAt/Difficulty existed on the model don't carry
        // those properties in Cosmos (schemaless), and the Cosmos provider's projection shaper
        // throws "Nullable object must have a value" reading them directly into a non-nullable
        // DTO constructor arg. Plain entity materialization defaults missing properties instead,
        // so build the DTO afterward in memory.
        var tunes = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var results = tunes
            .Select(t => new TuneDto(t.TuneId, t.Title, t.TuneType.ToString(), t.Key, t.RepertoireCount, t.Difficulty))
            .ToList();

        var hasMore = (page * pageSize) < totalCount;
        return new OkObjectResult(new PagedResult<TuneDto>(results, totalCount, page, pageSize, hasMore));
    }

    /// <summary>
    /// Reads the cached total tune count (kept in sync by LibraryStatsSupport on tune
    /// create/delete), lazily computing and persisting it the first time it's needed —
    /// e.g. right after this cache was introduced, before any create/delete has run yet.
    /// </summary>
    private async Task<int> GetCachedTuneCountAsync()
    {
        var stats = await db.LibraryStats.AsNoTracking().FirstOrDefaultAsync(s => s.LibraryStatsId == LibraryStats.SingletonId);
        if (stats is not null)
        {
            return stats.TuneCount;
        }

        var count = await db.Tunes.Select(t => t.TuneId).CosmosCountAsync();
        try
        {
            db.LibraryStats.Add(new LibraryStats { TuneCount = count });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // Benign race: another concurrent request already created the singleton. The
            // freshly-computed count is still correct to return either way.
            Console.Error.WriteLine($"[GetCachedTuneCountAsync] couldn't persist initial LibraryStats (likely a race, safe to ignore):\n{ex}");
        }
        return count;
    }
}
