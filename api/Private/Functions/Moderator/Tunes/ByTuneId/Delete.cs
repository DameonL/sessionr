using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Tunes.ByTuneId;

[RequireModerator]
public class Delete(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
    /// <summary>DELETE /api/moderator/tunes/{tuneId} — delete a tune permanently.</summary>
    [Function("ModeratorDeleteTune")]
    public async Task<IActionResult> ModeratorDeleteTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "moderator/tunes/{tuneId:guid}")] HttpRequest req,
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

        db.Tunes.Remove(tune);
        await db.SaveChangesAsync();
        await LibraryStatsSupport.DecrementTuneCountAsync(db);

        var purgeResult = await purgeService.PurgeTuneAsync(tuneId);
        // Without this the deleted tune keeps appearing in the library list and in search results.
        await purgeService.PurgeAllTunesAsync();
        // The repertoire and group rows outlive the tune here, so the sets are still findable.
        await SetCachePurge.PurgeSetsContainingTuneAsync(db, purgeService, tuneId);

        return new OkObjectResult(new { success = true, cloudflarePurgeResponse = purgeResult.IsSuccess ? null : purgeResult });
    }
}
