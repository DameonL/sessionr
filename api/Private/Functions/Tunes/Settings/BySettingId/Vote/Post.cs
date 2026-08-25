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

namespace SessionApp.Api.Functions.Tunes.Settings.BySettingId.Vote;

public class Post(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
    /// <summary>POST /api/tunes/settings/{settingId}/vote — cast an upvote or downvote on a setting.</summary>
    [Function("VoteTuneSetting")]
    public async Task<IActionResult> VoteTuneSetting(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "tunes/settings/{settingId:guid}/vote")] HttpRequest req,
        Guid settingId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<VoteSettingRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Value is required.");
        }

        var setting = await db.TuneSettings
            .SingleOrDefaultAsync(s => s.TuneSettingId == settingId);

        if (setting is null)
        {
            return new NotFoundResult();
        }

        var userExists = await db.Users.Where(u => u.UserId == callerUserId.Value).CosmosAnyAsync();
        if (!userExists)
        {
            return new BadRequestObjectResult("User does not exist.");
        }

        // The vote's tune is reached via TuneSetting, a separate Cosmos document, so resolve the
        // tune's setting ids first and match against those instead of dereferencing the nav.
        var tuneSettingIds = await db.TuneSettings
            .Where(s => s.TuneId == setting.TuneId)
            .Select(s => s.TuneSettingId)
            .ToListAsync();
        var hasVotedOnOtherSetting = await db.TuneSettingVotes
            .Where(v => v.UserId == callerUserId.Value
                     && v.TuneSettingId != settingId
                     && tuneSettingIds.Contains(v.TuneSettingId))
            .CosmosAnyAsync();
        if (hasVotedOnOtherSetting)
        {
            return new BadRequestObjectResult("You can only vote on a given tune once.");
        }

        var val = body.Value;
        if (val < -1) val = -1;
        if (val > 1) val = 1;

        var existingVote = await db.TuneSettingVotes
            .SingleOrDefaultAsync(v => v.TuneSettingId == settingId && v.UserId == callerUserId.Value);
        var previousValue = existingVote?.Value ?? 0;

        if (existingVote is not null)
        {
            if (val == 0)
            {
                db.TuneSettingVotes.Remove(existingVote);
            }
            else
            {
                existingVote.Value = val;
            }
        }
        else if (val != 0)
        {
            var vote = new TuneSettingVote
            {
                TuneSettingId = settingId,
                UserId = callerUserId.Value,
                Value = val
            };
            db.TuneSettingVotes.Add(vote);
        }

        setting.VoteScore += val - previousValue;

        await db.SaveChangesAsync();

        var purgeResult = await purgeService.PurgeTuneAsync(setting.TuneId);

        return new OkObjectResult(new { voteScore = setting.VoteScore, cloudflarePurgeResponse = purgeResult.IsSuccess ? null : purgeResult });
    }
}
