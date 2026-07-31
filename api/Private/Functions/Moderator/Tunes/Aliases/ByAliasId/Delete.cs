using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Tunes.Aliases.ByAliasId;

[RequireModerator]
public class Delete(AppDbContext db)
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

        db.TuneAliases.Remove(alias);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }
}
