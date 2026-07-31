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
        var search = req.Query["search"].ToString();
        var type = req.Query["type"].ToString();
        var key = req.Query["key"].ToString();

        var query = db.Tunes.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(search))
        {
            query = query.Where(t => EF.Functions.Like(t.Title, $"%{search}%")
                                  || t.Aliases.Any(a => EF.Functions.Like(a.Name, $"%{search}%")));
        }
        if (Enum.TryParse<TuneType>(type, ignoreCase: true, out var tuneType))
        {
            query = query.Where(t => t.TuneType == tuneType);
        }
        if (!string.IsNullOrWhiteSpace(key))
        {
            query = query.Where(t => t.Key == key);
        }

        var sort = req.Query["sort"].ToString().ToLower();

        int.TryParse(req.Query["page"], out var page);
        if (page < 1) page = 1;

        int.TryParse(req.Query["pageSize"], out var pageSize);
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 100) pageSize = 100;

        var totalCount = await query.CountAsync();

        if (sort == "popular")
        {
            query = query.OrderByDescending(t => t.RepertoireCount)
                .ThenBy(t => t.Title.StartsWith("The ") ? t.Title.Substring(4)
                    : t.Title.StartsWith("A ") ? t.Title.Substring(2)
                    : t.Title);
        }
        else if (sort == "newest")
        {
            query = query.OrderByDescending(t => t.CreatedAt)
                .ThenBy(t => t.Title.StartsWith("The ") ? t.Title.Substring(4)
                    : t.Title.StartsWith("A ") ? t.Title.Substring(2)
                    : t.Title);
        }
        else
        {
            query = query.OrderBy(t => t.Title.StartsWith("The ") ? t.Title.Substring(4)
                : t.Title.StartsWith("A ") ? t.Title.Substring(2)
                : t.Title);
        }

        var results = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(t => new TuneDto(t.TuneId, t.Title, t.TuneType.ToString(), t.Key))
            .ToListAsync();


        var hasMore = (page * pageSize) < totalCount;
        return new OkObjectResult(new PagedResult<TuneDto>(results, totalCount, page, pageSize, hasMore));
    }
}
