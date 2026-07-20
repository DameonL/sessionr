using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

public class EarTrainingFunctions(AppDbContext db, ILogger<EarTrainingFunctions> logger)
{
    /// <summary>GET /api/repertoire/items/{userTuneId}/ear-training — saved progress, or a fresh default.</summary>
    [Function("GetEarTrainingProgress")]
    public async Task<IActionResult> GetEarTrainingProgress(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "repertoire/items/{userTuneId:int}/ear-training")] HttpRequest req,
        int userTuneId)
    {
        var progress = await db.EarTrainingProgress
            .AsNoTracking()
            .SingleOrDefaultAsync(e => e.UserTuneId == userTuneId);

        var dto = progress is null
            ? new EarTrainingProgressDto(userTuneId, 0, 0, null)
            : new EarTrainingProgressDto(progress.UserTuneId, progress.PhraseIndex, progress.NotesRevealed, progress.CompletedAt);

        return new OkObjectResult(dto);
    }

    /// <summary>PUT /api/repertoire/items/{userTuneId}/ear-training — upsert resumable progress.</summary>
    [Function("SaveEarTrainingProgress")]
    public async Task<IActionResult> SaveEarTrainingProgress(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "repertoire/items/{userTuneId:int}/ear-training")] HttpRequest req,
        int userTuneId)
    {
        var body = await req.ReadFromJsonAsync<SaveEarTrainingProgressRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request body is required.");
        }
        if (body.PhraseIndex < 0 || body.NotesRevealed < 0)
        {
            return new BadRequestObjectResult("PhraseIndex and NotesRevealed must be non-negative.");
        }

        var userTuneExists = await db.UserTunes.AnyAsync(ut => ut.UserTuneId == userTuneId);
        if (!userTuneExists)
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
