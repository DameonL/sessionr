using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Repertoire.Items.ByUserTuneId;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/repertoire/items/{userTuneId} — full detail (including ABC) for a single repertoire tune.</summary>
    [Function("GetRepertoireItem")]
    public async Task<IActionResult> GetRepertoireItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "repertoire/items/{userTuneId:guid}")] HttpRequest req,
        Guid userTuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var userTune = await db.UserTunes
            .AsNoTracking()
            .SingleOrDefaultAsync(ut => ut.UserTuneId == userTuneId && ut.UserId == callerUserId.Value);

        if (userTune is null)
        {
            return new NotFoundResult();
        }

        var single = new[] { userTune };
        await SetSupport.PopulateTuneAndSettingAsync(db, single);
        await RepertoireSupport.ResolveUnpinnedSettingsAsync(db, single);

        return new OkObjectResult(RepertoireSupport.ToItemDto(userTune));
    }
}
