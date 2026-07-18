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
            query = query.Where(t => EF.Functions.Like(t.Title, $"%{search}%"));
        }
        if (Enum.TryParse<TuneType>(type, ignoreCase: true, out var tuneType))
        {
            query = query.Where(t => t.TuneType == tuneType);
        }
        if (!string.IsNullOrWhiteSpace(key))
        {
            query = query.Where(t => t.Key == key);
        }

        var results = await query
            // Trad convention: ignore a leading "The" or "A" when sorting titles.
            .OrderBy(t => t.Title.StartsWith("The ") ? t.Title.Substring(4)
                : t.Title.StartsWith("A ") ? t.Title.Substring(2)
                : t.Title)
            .Take(50)
            .Select(t => new TuneDto(t.TuneId, t.Title, t.TuneType.ToString(), t.Key))
            .ToListAsync();

        return new OkObjectResult(results);
    }

    /// <summary>POST /api/tunes — add a tune to the global library.</summary>
    [Function("CreateTune")]
    public async Task<IActionResult> CreateTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "tunes")] HttpRequest req)
    {
        var body = await req.ReadFromJsonAsync<CreateTuneRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Title) || string.IsNullOrWhiteSpace(body.Abc))
        {
            return new BadRequestObjectResult("Title and Abc are required.");
        }
        if (!Enum.TryParse<TuneType>(body.TuneType, ignoreCase: true, out var tuneType))
        {
            tuneType = TuneType.Other;
        }

        var tune = new Tune
        {
            Title = body.Title.Trim(),
            TuneType = tuneType,
            Key = body.Key.Trim(),
            MasterAbcText = body.Abc,
        };
        db.Tunes.Add(tune);
        await db.SaveChangesAsync();

        return new OkObjectResult(new TuneDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key));
    }
}
