using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions.Tunes.ByTuneId;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/tunes/{tuneId} — fetch full tune details, alternate settings, and aliases.</summary>
    [Function("GetTuneDetails")]
    public async Task<IActionResult> GetTuneDetails(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "tunes/{tuneId:guid}")] HttpRequest req,
        Guid tuneId)
    {
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
