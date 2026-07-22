using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

public class TuneFunctions(AppDbContext db)
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

        int.TryParse(req.Query["page"], out var page);
        if (page < 1) page = 1;

        int.TryParse(req.Query["pageSize"], out var pageSize);
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 100) pageSize = 100;

        var totalCount = await query.CountAsync();

        var results = await query
            // Trad convention: ignore a leading "The" or "A" when sorting titles.
            .OrderBy(t => t.Title.StartsWith("The ") ? t.Title.Substring(4)
                : t.Title.StartsWith("A ") ? t.Title.Substring(2)
                : t.Title)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(t => new TuneDto(t.TuneId, t.Title, t.TuneType.ToString(), t.Key))
            .ToListAsync();

        var hasMore = (page * pageSize) < totalCount;
        return new OkObjectResult(new PagedResult<TuneDto>(results, totalCount, page, pageSize, hasMore));
    }

    /// <summary>GET /api/tunes/{tuneId} — fetch full tune details, alternate settings, and aliases.</summary>
    [Function("GetTuneDetails")]
    public async Task<IActionResult> GetTuneDetails(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "tunes/{tuneId:guid}")] HttpRequest req,
        Guid tuneId)
    {
        // Anonymous, unauthenticated route: never trust a caller-supplied userId — userVote
        // always comes back 0 here, so there's no need to load any Votes at all. Signed-in
        // callers get their real vote from the Private app's GetTuneDetails instead.
        var tune = await db.Tunes
            .AsNoTracking()
            .Include(t => t.Aliases)
            .Include(t => t.Settings)
            .SingleOrDefaultAsync(t => t.TuneId == tuneId);

        if (tune is null)
        {
            return new NotFoundResult();
        }

        var aliases = tune.Aliases.Select(a => a.Name).ToList();
        var settings = tune.Settings
            .Select(s => new TuneSettingDto(s.TuneSettingId, s.Key, s.AbcText, s.SubmitterName, s.VoteScore, 0))
            .OrderByDescending(s => s.VoteScore)
            .ToList();

        return new OkObjectResult(new TuneDetailsDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key, aliases, settings));
    }
}
