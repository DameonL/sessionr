using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Tunes.RecomputeHeuristics;

[RequireModerator]
public class Post(AppDbContext db, TuneHeuristics heuristics)
{
    public record RecomputeResult(int TunesUpdated, int SettingsUpdated);

    private const int BatchSize = 200;

    /// <summary>
    /// POST /api/moderator/tunes/recompute-heuristics — one-off backfill that
    /// recomputes the stored melodic heuristics (and melody fingerprint, used by
    /// tune identification — see TuneMatchIndex) for every tune and tune setting
    /// from its ABC. Run once after deploying these fields (existing Cosmos
    /// documents otherwise carry the CLR defaults). Batched so it works on Cosmos.
    /// Follow with POST /api/moderator/tunes/refresh-match-index so the in-memory
    /// match index picks up the backfilled fingerprints immediately.
    /// </summary>
    [Function("RecomputeTuneHeuristics")]
    public async Task<IActionResult> RecomputeTuneHeuristics(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "moderator/tunes/recompute-heuristics")] HttpRequest req)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var tuneTypeById = new System.Collections.Generic.Dictionary<System.Guid, TuneType>();

        var tunesUpdated = 0;
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
                tuneTypeById[tune.TuneId] = tune.TuneType;
                tunesUpdated++;
            }
            await db.SaveChangesAsync();
            skip += batch.Count;

            if (batch.Count < BatchSize)
            {
                break;
            }
        }

        var settingsUpdated = 0;
        skip = 0;
        while (true)
        {
            var batch = await db.TuneSettings
                .OrderBy(s => s.TuneSettingId)
                .Skip(skip)
                .Take(BatchSize)
                .ToListAsync();
            if (batch.Count == 0)
            {
                break;
            }

            foreach (var setting in batch)
            {
                if (!tuneTypeById.TryGetValue(setting.TuneId, out var tuneType))
                {
                    var owner = await db.Tunes.AsNoTracking().SingleOrDefaultAsync(t => t.TuneId == setting.TuneId);
                    if (owner is null) continue;
                    tuneType = owner.TuneType;
                    tuneTypeById[setting.TuneId] = tuneType;
                }

                heuristics.ApplyFingerprint(setting, tuneType);
                settingsUpdated++;
            }
            await db.SaveChangesAsync();
            skip += batch.Count;

            if (batch.Count < BatchSize)
            {
                break;
            }
        }

        await LibraryStatsSupport.MarkTunesChangedAsync(db);

        return new OkObjectResult(new RecomputeResult(tunesUpdated, settingsUpdated));
    }
}
