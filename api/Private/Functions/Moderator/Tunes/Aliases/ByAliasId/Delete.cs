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

namespace SessionApp.Api.Functions.Moderator.Tunes.Aliases.ByAliasId;

[RequireModerator]
public class Delete(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
    /// <summary>DELETE /api/moderator/tunes/aliases/{aliasId} — delete a tune alias.</summary>
    [Function("ModeratorDeleteTuneAlias")]
    public async Task<IActionResult> ModeratorDeleteTuneAlias(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "moderator/tunes/aliases/{aliasId:guid}")] HttpRequest req,
        Guid aliasId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var alias = await db.TuneAliases.SingleOrDefaultAsync(a => a.TuneAliasId == aliasId);
        if (alias is null)
        {
            return new NotFoundResult();
        }

        var tuneId = alias.TuneId;
        db.TuneAliases.Remove(alias);
        await db.SaveChangesAsync();

        // Aliases are part of the tune's cached detail payload.
        await purgeService.PurgeTuneAsync(tuneId);

        return new NoContentResult();
    }
}
