using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Repertoire;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/repertoire — add a global tune to the user's repertoire.</summary>
    [Function("AddToRepertoire")]
    public async Task<IActionResult> AddToRepertoire(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "repertoire")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return new UnauthorizedObjectResult("Authentication credentials are required.");
        }

        AddToRepertoireRequest? body = null;
        try
        {
            body = await req.ReadFromJsonAsync<AddToRepertoireRequest>();
        }
        catch
        {
            return new BadRequestObjectResult("Invalid JSON payload.");
        }

        if (body is null || body.TuneId == Guid.Empty)
        {
            return new BadRequestObjectResult("TuneId is required.");
        }

        var tune = await db.Tunes.SingleOrDefaultAsync(t => t.TuneId == body.TuneId);
        if (tune is null)
        {
            return new NotFoundObjectResult($"Tune {body.TuneId} not found.");
        }

        var exists = await db.UserTunes.AnyAsync(ut => ut.UserId == callerUserId.Value && ut.TuneId == body.TuneId);
        if (exists)
        {
            return new ConflictObjectResult("Tune is already in the repertoire.");
        }

        TuneSetting? selectedSetting = null;
        if (body.TuneSettingId is not null && body.TuneSettingId != Guid.Empty)
        {
            selectedSetting = await db.TuneSettings.SingleOrDefaultAsync(s => s.TuneSettingId == body.TuneSettingId && s.TuneId == body.TuneId);
            if (selectedSetting is null)
            {
                return new BadRequestObjectResult("TuneSettingId does not belong to the given tune.");
            }
        }

        var userTune = new UserTune
        {
            UserId = callerUserId.Value,
            TuneId = body.TuneId,
            TuneSettingId = selectedSetting?.TuneSettingId ?? body.TuneSettingId,
            Status = TuneStatus.Learning,
            TargetBpm = Tune.GetDefaultTargetBpm(tune.TuneType),
        };
        db.UserTunes.Add(userTune);
        tune.RepertoireCount++;
        await db.SaveChangesAsync();

        var effectiveKey = selectedSetting != null ? selectedSetting.Key : tune.Key;
        var effectiveAbc = selectedSetting != null ? selectedSetting.AbcText : tune.MasterAbcText;

        return new OkObjectResult(new RepertoireItemDto(
            userTune.UserTuneId,
            userTune.TuneId,
            tune.Title,
            tune.TuneType.ToString(),
            effectiveKey,
            userTune.Status.ToString(),
            userTune.LastPracticed,
            userTune.TargetBpm,
            effectiveAbc,
            false));
    }
}
