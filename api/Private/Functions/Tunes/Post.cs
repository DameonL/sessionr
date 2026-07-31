using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Tunes;

public class Post(AppDbContext db)
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
}
