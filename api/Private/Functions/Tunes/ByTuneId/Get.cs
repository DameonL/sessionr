using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Tunes.ByTuneId;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/tunes/{tuneId} — fetch tune details, alternate settings, aliases, and the caller's own votes (requires sign-in).</summary>
    [Function("GetTuneDetails")]
    public async Task<IActionResult> GetTuneDetails(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "tunes/{tuneId:guid}")] HttpRequest req,
        Guid tuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }
        var userId = callerUserId.Value;

        var tune = await db.Tunes
            .AsNoTracking()
            .Include(t => t.Aliases)
            .Include(t => t.Settings)
            .SingleOrDefaultAsync(t => t.TuneId == tuneId);

        if (tune is null)
        {
            return new NotFoundResult();
        }

        var myVotes = await db.TuneSettingVotes
            .AsNoTracking()
            .Where(v => v.UserId == userId && v.TuneSetting.TuneId == tuneId)
            .ToDictionaryAsync(v => v.TuneSettingId, v => v.Value);

        var aliases = tune.Aliases.Select(a => a.Name).ToList();
        var settings = tune.Settings
            .Select(s => new TuneSettingDto(s.TuneSettingId, s.Key, s.AbcText, s.SubmitterName, s.VoteScore, myVotes.GetValueOrDefault(s.TuneSettingId)))
            .OrderByDescending(s => s.VoteScore)
            .ToList();

        return new OkObjectResult(new TuneDetailsDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key, aliases, settings));
    }
}
