using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Repertoire.Items.ByUserTuneId.EarTraining;

public class Put(AppDbContext db, ILogger<Put> logger)
{
    /// <summary>PUT /api/repertoire/items/{userTuneId}/ear-training — upsert resumable progress.</summary>
    [Function("SaveEarTrainingProgress")]
    public async Task<IActionResult> SaveEarTrainingProgress(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "repertoire/items/{userTuneId:guid}/ear-training")] HttpRequest req,
        Guid userTuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<SaveEarTrainingProgressRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request body is required.");
        }
        if (body.PhraseIndex < 0 || body.NotesRevealed < 0)
        {
            return new BadRequestObjectResult("PhraseIndex and NotesRevealed must be non-negative.");
        }

        var userTune = await db.UserTunes.SingleOrDefaultAsync(ut => ut.UserTuneId == userTuneId && ut.UserId == callerUserId.Value);
        if (userTune is null)
        {
            return new NotFoundResult();
        }

        var progress = await db.EarTrainingProgress.SingleOrDefaultAsync(e => e.UserTuneId == userTuneId);
        if (progress is null)
        {
            progress = new EarTrainingProgress { UserTuneId = userTuneId };
            db.EarTrainingProgress.Add(progress);
        }

        progress.PhraseIndex = body.PhraseIndex;
        progress.NotesRevealed = body.NotesRevealed;
        progress.CompletedAt = body.Completed ? progress.CompletedAt ?? DateTime.UtcNow : null;
        progress.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();

        logger.LogInformation(
            "Ear training progress for user tune {UserTuneId}: phrase {PhraseIndex}, completed {Completed}",
            userTuneId, body.PhraseIndex, body.Completed);

        return new OkObjectResult(new EarTrainingProgressDto(
            progress.UserTuneId, progress.PhraseIndex, progress.NotesRevealed, progress.CompletedAt));
    }
}
