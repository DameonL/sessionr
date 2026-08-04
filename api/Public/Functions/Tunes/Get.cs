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
        var search = req.Query["search"].ToString().Trim();
        var type = req.Query["type"].ToString().Trim();
        var key = req.Query["key"].ToString().Trim();

        var query = db.Tunes.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(search))
        {
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
            query = query.Where(t => t.TuneType == tuneType);
        }
        if (!string.IsNullOrWhiteSpace(key))
        {
            query = query.Where(t => t.Key == key);
        }

        var sort = req.Query["sort"].ToString().ToLower().Trim();

        int.TryParse(req.Query["page"], out var page);
        if (page < 1) page = 1;

        int.TryParse(req.Query["pageSize"], out var pageSize);
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 100) pageSize = 100;

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

        var totalCount = await query.CountAsync();

        var results = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(t => new TuneDto(t.TuneId, t.Title, t.TuneType.ToString(), t.Key, t.RepertoireCount))
            .ToListAsync();

        var hasMore = (page * pageSize) < totalCount;
        return new OkObjectResult(new PagedResult<TuneDto>(results, totalCount, page, pageSize, hasMore));
    }
}
