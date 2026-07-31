using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Repertoire.Items.ByUserTuneId.EarTraining;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/repertoire/items/{userTuneId}/ear-training — saved progress, or a fresh default.</summary>
    [Function("GetEarTrainingProgress")]
    public async Task<IActionResult> GetEarTrainingProgress(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "repertoire/items/{userTuneId:guid}/ear-training")] HttpRequest req,
        Guid userTuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var userTune = await db.UserTunes.AsNoTracking().SingleOrDefaultAsync(ut => ut.UserTuneId == userTuneId && ut.UserId == callerUserId.Value);
        if (userTune is null)
        {
            return new NotFoundResult();
        }

        var progress = await db.EarTrainingProgress
            .AsNoTracking()
            .SingleOrDefaultAsync(e => e.UserTuneId == userTuneId);

        var dto = progress is null
            ? new EarTrainingProgressDto(userTuneId, 0, 0, null)
            : new EarTrainingProgressDto(progress.UserTuneId, progress.PhraseIndex, progress.NotesRevealed, progress.CompletedAt);

        return new OkObjectResult(dto);
    }
}
