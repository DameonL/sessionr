using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Tunes.ByTuneId;

[RequireModerator]
public class Put(AppDbContext db, TuneHeuristics heuristics)
{
    public record UpdateMasterTuneRequest(string Title, string TuneType, string Key, string MasterAbcText);

    /// <summary>PUT /api/moderator/tunes/{tuneId} — edit master tune details.</summary>
    [Function("ModeratorUpdateTune")]
    public async Task<IActionResult> ModeratorUpdateTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "moderator/tunes/{tuneId:guid}")] HttpRequest req,
        Guid tuneId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var body = await req.ReadFromJsonAsync<UpdateMasterTuneRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Title) || string.IsNullOrWhiteSpace(body.MasterAbcText))
        {
            return new BadRequestObjectResult("Title and MasterAbcText are required.");
        }

        var tune = await db.Tunes.SingleOrDefaultAsync(t => t.TuneId == tuneId);
        if (tune is null)
        {
            return new NotFoundResult();
        }

        if (!Enum.TryParse<TuneType>(body.TuneType, ignoreCase: true, out var tuneType))
        {
            tuneType = TuneType.Other;
        }

        tune.Title = body.Title.Trim();
        tune.TuneType = tuneType;
        tune.Key = body.Key.Trim();
        tune.MasterAbcText = body.MasterAbcText;
        heuristics.Apply(tune);

        await db.SaveChangesAsync();
        await LibraryStatsSupport.MarkTunesChangedAsync(db);
        return new OkObjectResult(new UnreviewedTunes.Get.ModeratorTuneDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key, tune.MasterAbcText, tune.IsReviewed, tune.ReviewedAt, tune.ReviewedBy, tune.CreatedAt));
    }
}
