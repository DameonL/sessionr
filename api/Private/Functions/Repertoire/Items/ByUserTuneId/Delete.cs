using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Repertoire.Items.ByUserTuneId;

public class Delete(AppDbContext db)
{
    /// <summary>DELETE /api/repertoire/items/{userTuneId} — remove a tune from the user's repertoire.</summary>
    [Function("RemoveRepertoireItem")]
    public async Task<IActionResult> RemoveRepertoireItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "repertoire/items/{userTuneId:guid}")] HttpRequest req,
        Guid userTuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var userTune = await db.UserTunes
            .SingleOrDefaultAsync(ut => ut.UserTuneId == userTuneId && ut.UserId == callerUserId.Value);

        if (userTune is null)
        {
            return new NotFoundResult();
        }

        var usedInSets = await db.SetItems.AnyAsync(si => si.UserTuneId == userTuneId);
        if (usedInSets)
        {
            return new ConflictObjectResult("Tune is used in one or more sets. Remove it from those sets first.");
        }

        var tune = await db.Tunes.SingleOrDefaultAsync(t => t.TuneId == userTune.TuneId);
        if (tune != null && tune.RepertoireCount > 0)
        {
            tune.RepertoireCount--;
        }

        db.UserTunes.Remove(userTune);
        await db.SaveChangesAsync();

        return new NoContentResult();
    }
}
