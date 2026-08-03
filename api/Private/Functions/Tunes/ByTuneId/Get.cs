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
            .SingleOrDefaultAsync(t => t.TuneId == tuneId);

        if (tune is null)
        {
            return new NotFoundResult();
        }

        // Aliases, settings and votes are separate Cosmos documents keyed by TuneId/TuneSettingId.
        var aliases = await db.TuneAliases
            .AsNoTracking()
            .Where(a => a.TuneId == tuneId)
            .Select(a => a.Name)
            .ToListAsync();

        var settingEntities = await db.TuneSettings
            .AsNoTracking()
            .Where(s => s.TuneId == tuneId)
            .ToListAsync();
        var settingIds = settingEntities.Select(s => s.TuneSettingId).ToList();

        var myVotes = await db.TuneSettingVotes
            .AsNoTracking()
            .Where(v => v.UserId == userId && settingIds.Contains(v.TuneSettingId))
            .ToDictionaryAsync(v => v.TuneSettingId, v => v.Value);

        var settings = settingEntities
            .Select(s => new TuneSettingDto(s.TuneSettingId, s.Key, s.AbcText, s.SubmitterName, s.VoteScore, myVotes.GetValueOrDefault(s.TuneSettingId)))
            .OrderByDescending(s => s.VoteScore)
            .ToList();

        return new OkObjectResult(new TuneDetailsDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key, aliases, settings));
    }
}
