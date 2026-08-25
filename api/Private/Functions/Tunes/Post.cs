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

public class Post(AppDbContext db, TuneHeuristics heuristics, ICloudflareCachePurgeService purgeService)
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
        if (body is null || string.IsNullOrWhiteSpace(body.Abc))
        {
            return new BadRequestObjectResult("ABC notation is required.");
        }

        var parseResult = TuneHeuristics.ParseAndNormalizeAbc(body.Abc);
        if (!parseResult.IsValid)
        {
            return new BadRequestObjectResult($"ABC notation is missing required header(s): {string.Join(", ", parseResult.MissingHeaders)}.");
        }

        var tune = new Tune
        {
            Title = parseResult.Title,
            TuneType = parseResult.TuneType,
            Key = parseResult.Key,
            MasterAbcText = parseResult.NormalizedAbc,
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

        await purgeService.PurgeAllTunesAsync();

        return new OkObjectResult(new TuneDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key, tune.RepertoireCount, tune.Difficulty));
    }
}
