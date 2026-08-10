using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Tunes.RecomputeHeuristics;

[RequireModerator]
public class Post(AppDbContext db, TuneHeuristics heuristics)
{
    public record RecomputeResult(int TunesUpdated);

    private const int BatchSize = 200;

    /// <summary>
    /// POST /api/moderator/tunes/recompute-heuristics — one-off backfill that
    /// recomputes the stored melodic heuristics for every tune from its ABC.
    /// Run once after deploying the heuristic fields (existing Cosmos documents
    /// otherwise carry the CLR defaults). Batched so it works on Cosmos.
    /// </summary>
    [Function("RecomputeTuneHeuristics")]
    public async Task<IActionResult> RecomputeTuneHeuristics(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "moderator/tunes/recompute-heuristics")] HttpRequest req)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var updated = 0;
        var skip = 0;
        while (true)
        {
            var batch = await db.Tunes
                .OrderBy(t => t.TuneId)
                .Skip(skip)
                .Take(BatchSize)
                .ToListAsync();
            if (batch.Count == 0)
            {
                break;
            }

            foreach (var tune in batch)
            {
                heuristics.Apply(tune);
                updated++;
            }
            await db.SaveChangesAsync();
            skip += batch.Count;

            if (batch.Count < BatchSize)
            {
                break;
            }
        }

        return new OkObjectResult(new RecomputeResult(updated));
    }
}
