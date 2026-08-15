using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Tunes;

public class Post(AppDbContext db, TuneHeuristics heuristics)
{
    /// <summary>POST /api/tunes — add a tune to the global library.</summary>
    [Function("CreateTune")]
    public async Task<IActionResult> CreateTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "tunes")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

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
        heuristics.Apply(tune);
        db.Tunes.Add(tune);
        await db.SaveChangesAsync();
        await LibraryStatsSupport.IncrementTuneCountAsync(db);

        var submitterName = await db.Users.AsNoTracking()
            .Where(u => u.UserId == callerUserId.Value)
            .Select(u => u.DisplayName)
            .FirstOrDefaultAsync();

        var setting = new TuneSetting
        {
            TuneId = tune.TuneId,
            Key = tune.Key,
            AbcText = tune.MasterAbcText,
            SubmitterName = string.IsNullOrWhiteSpace(submitterName) ? "Anonymous" : submitterName,
            VoteScore = 3
        };
        db.TuneSettings.Add(setting);
        await db.SaveChangesAsync();

        return new OkObjectResult(new TuneDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key, tune.RepertoireCount, tune.Difficulty));
    }
}
