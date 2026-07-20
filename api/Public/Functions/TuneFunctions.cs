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

    /// <summary>GET /api/tunes/{tuneId} — fetch full tune details, alternate settings, and aliases.</summary>
    [Function("GetTuneDetails")]
    public async Task<IActionResult> GetTuneDetails(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "tunes/{tuneId:guid}")] HttpRequest req,
        Guid tuneId)
    {
        Guid.TryParse(req.Query["userId"], out var userId);

        var tune = await db.Tunes
            .AsNoTracking()
            .Include(t => t.Aliases)
            .Include(t => t.Settings)
                .ThenInclude(s => s.Votes)
            .SingleOrDefaultAsync(t => t.TuneId == tuneId);

        if (tune is null)
        {
            return new NotFoundResult();
        }

        var aliases = tune.Aliases.Select(a => a.Name).ToList();
        var settings = tune.Settings
            .Select(s => {
                var userVote = s.Votes.FirstOrDefault(v => v.UserId == userId)?.Value ?? 0;
                return new TuneSettingDto(s.TuneSettingId, s.Key, s.AbcText, s.SubmitterName, s.VoteScore, userVote);
            })
            .OrderByDescending(s => s.VoteScore)
            .ToList();

        return new OkObjectResult(new TuneDetailsDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key, aliases, settings));
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
