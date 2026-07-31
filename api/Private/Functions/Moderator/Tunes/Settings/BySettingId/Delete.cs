using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Tunes.Settings.BySettingId;

[RequireModerator]
public class Delete(AppDbContext db)
{
    /// <summary>DELETE /api/moderator/tunes/settings/{settingId} — delete a tune setting.</summary>
    [Function("ModeratorDeleteTuneSetting")]
    public async Task<IActionResult> ModeratorDeleteTuneSetting(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "moderator/tunes/settings/{settingId:guid}")] HttpRequest req,
        Guid settingId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var setting = await db.TuneSettings.SingleOrDefaultAsync(s => s.TuneSettingId == settingId);
        if (setting is null)
        {
            return new NotFoundResult();
        }

        db.TuneSettings.Remove(setting);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }
}
