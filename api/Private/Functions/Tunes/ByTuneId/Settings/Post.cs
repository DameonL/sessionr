using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Tunes.ByTuneId.Settings;

public class Post(AppDbContext db, TuneHeuristics heuristics)
{
    /// <summary>POST /api/tunes/{tuneId}/settings — add an alternate setting to the tune.</summary>
    [Function("CreateTuneSetting")]
    public async Task<IActionResult> CreateTuneSetting(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "tunes/{tuneId:guid}/settings")] HttpRequest req,
        Guid tuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<CreateSettingRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Key) || string.IsNullOrWhiteSpace(body.Abc))
        {
            return new BadRequestObjectResult("Key and Abc are required.");
        }

        var tune = await db.Tunes.SingleOrDefaultAsync(t => t.TuneId == tuneId);
        if (tune is null)
        {
            return new NotFoundResult();
        }

        var setting = new TuneSetting
        {
            TuneId = tuneId,
            Key = body.Key.Trim(),
            AbcText = body.Abc,
            SubmitterName = string.IsNullOrWhiteSpace(body.SubmitterName) ? "Anonymous" : body.SubmitterName.Trim(),
            VoteScore = 1
        };
        heuristics.ApplyFingerprint(setting, tune.TuneType);
        db.TuneSettings.Add(setting);
        await db.SaveChangesAsync();
        await LibraryStatsSupport.MarkTunesChangedAsync(db);

        return new OkObjectResult(new TuneSettingDto(setting.TuneSettingId, setting.Key, setting.AbcText, setting.SubmitterName, setting.VoteScore, 0));
    }
}
