using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Tunes.ByTuneId;

[RequireModerator]
public class Delete(AppDbContext db)
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
        return new NoContentResult();
    }
}
