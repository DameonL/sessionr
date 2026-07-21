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

public class PrivateTuneFunctions(AppDbContext db)
{
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

        var setting = new TuneSetting
        {
            TuneId = tune.TuneId,
            Key = tune.Key,
            AbcText = tune.MasterAbcText,
            SubmitterName = "System",
            VoteScore = 3
        };
        db.TuneSettings.Add(setting);
        await db.SaveChangesAsync();

        return new OkObjectResult(new TuneDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key));
    }

    /// <summary>POST /api/tunes/{tuneId}/settings — add an alternate setting to the tune.</summary>
    [Function("CreateTuneSetting")]
    public async Task<IActionResult> CreateTuneSetting(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "tunes/{tuneId:guid}/settings")] HttpRequest req,
        Guid tuneId)
    {
        var body = await req.ReadFromJsonAsync<CreateSettingRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Key) || string.IsNullOrWhiteSpace(body.Abc))
        {
            return new BadRequestObjectResult("Key and Abc are required.");
        }

        var tune = await db.Tunes.FindAsync(tuneId);
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
        db.TuneSettings.Add(setting);
        await db.SaveChangesAsync();

        return new OkObjectResult(new TuneSettingDto(setting.TuneSettingId, setting.Key, setting.AbcText, setting.SubmitterName, setting.VoteScore, 0));
    }

    /// <summary>POST /api/tunes/{tuneId}/aliases — add an alternate name to the tune.</summary>
    [Function("CreateTuneAlias")]
    public async Task<IActionResult> CreateTuneAlias(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "tunes/{tuneId:guid}/aliases")] HttpRequest req,
        Guid tuneId)
    {
        var body = await req.ReadFromJsonAsync<CreateAliasRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Name))
        {
            return new BadRequestObjectResult("Name is required.");
        }

        var tune = await db.Tunes.FindAsync(tuneId);
        if (tune is null)
        {
            return new NotFoundResult();
        }

        var alias = new TuneAlias
        {
            TuneId = tuneId,
            Name = body.Name.Trim()
        };
        db.TuneAliases.Add(alias);
        await db.SaveChangesAsync();

        return new OkObjectResult(new { Name = alias.Name });
    }

    /// <summary>POST /api/tunes/settings/{settingId}/vote — cast an upvote or downvote on a setting.</summary>
    [Function("VoteTuneSetting")]
    public async Task<IActionResult> VoteTuneSetting(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "tunes/settings/{settingId:guid}/vote")] HttpRequest req,
        Guid settingId)
    {
        var body = await req.ReadFromJsonAsync<VoteSettingRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId and Value are required.");
        }

        var setting = await db.TuneSettings
            .Include(s => s.Votes)
            .SingleOrDefaultAsync(s => s.TuneSettingId == settingId);

        if (setting is null)
        {
            return new NotFoundResult();
        }

        // Only registered users get to vote on tunes
        var userExists = await db.Users.AnyAsync(u => u.UserId == body.UserId);
        if (!userExists)
        {
            return new BadRequestObjectResult("User does not exist.");
        }

        // They can only vote on a given tune once
        var hasVotedOnOtherSetting = await db.TuneSettingVotes
            .AnyAsync(v => v.UserId == body.UserId 
                        && v.TuneSetting.TuneId == setting.TuneId 
                        && v.TuneSettingId != settingId);
        if (hasVotedOnOtherSetting)
        {
            return new BadRequestObjectResult("You can only vote on a given tune once.");
        }

        var val = body.Value;
        if (val < -1) val = -1;
        if (val > 1) val = 1;

        var existingVote = setting.Votes.FirstOrDefault(v => v.UserId == body.UserId);
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
                UserId = body.UserId,
                Value = val
            };
            db.TuneSettingVotes.Add(vote);
        }

        await db.SaveChangesAsync();

        var score = await db.TuneSettingVotes
            .Where(v => v.TuneSettingId == settingId)
            .SumAsync(v => v.Value);

        setting.VoteScore = score;
        await db.SaveChangesAsync();

        return new OkObjectResult(new { VoteScore = score });
    }
}
