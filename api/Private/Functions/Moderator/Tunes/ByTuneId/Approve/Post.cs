using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Tunes.ByTuneId.Approve;

[RequireModerator]
public class Post(AppDbContext db)
{
    /// <summary>POST /api/moderator/tunes/{tuneId}/approve — mark a tune as reviewed and approved.</summary>
    [Function("ApproveTune")]
    public async Task<IActionResult> ApproveTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "moderator/tunes/{tuneId:guid}/approve")] HttpRequest req,
        Guid tuneId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var tune = await db.Tunes.SingleOrDefaultAsync(t => t.TuneId == tuneId);
        if (tune is null)
        {
            return new NotFoundResult();
        }

        var caller = req.GetCallerIdentity();
        tune.IsReviewed = true;
        tune.ReviewedAt = DateTime.UtcNow;
        tune.ReviewedBy = caller.Email ?? caller.DisplayName ?? caller.UserId?.ToString() ?? "Moderator";

        await db.SaveChangesAsync();
        return new OkObjectResult(new UnreviewedTunes.Get.ModeratorTuneDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key, tune.MasterAbcText, tune.IsReviewed, tune.ReviewedAt, tune.ReviewedBy, tune.CreatedAt));
    }
}
