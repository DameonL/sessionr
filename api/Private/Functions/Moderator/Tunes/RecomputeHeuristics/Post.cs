using System;
using System.Collections.Generic;
using System.Linq;
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

    private const int BatchSize = 100;

    /// <summary>
    /// POST /api/moderator/tunes/recompute-heuristics — one-off backfill that
    /// recomputes the stored melodic heuristics (and melody fingerprint, used by
    /// tune identification — see TuneMatchIndex) for every tune and tune setting
    /// from its ABC. Run once after deploying these fields (existing Cosmos
    /// documents otherwise carry the CLR defaults). Uses ID-chunked Contains batches
    /// rather than Skip/Take so Cosmos does not incur O(N^2) skipped reads.
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

        var ct = req.HttpContext.RequestAborted;
        var tuneTypeById = new Dictionary<Guid, TuneType>();

        var tuneIds = await db.Tunes.AsNoTracking().Select(t => t.TuneId).ToListAsync(ct);
        var tunesUpdated = 0;
        foreach (var chunk in tuneIds.Chunk(BatchSize))
        {
            var chunkIds = chunk.ToList();
            var batch = await db.Tunes
                .Where(t => chunkIds.Contains(t.TuneId))
                .ToListAsync(ct);
            if (batch.Count == 0)
            {
                continue;
            }

            foreach (var tune in batch)
            {
                heuristics.Apply(tune);
                tuneTypeById[tune.TuneId] = tune.TuneType;
                tunesUpdated++;
            }
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
        }

        var settingIds = await db.TuneSettings.AsNoTracking().Select(s => s.TuneSettingId).ToListAsync(ct);
        var settingsUpdated = 0;
        foreach (var chunk in settingIds.Chunk(BatchSize))
        {
            var chunkIds = chunk.ToList();
            var batch = await db.TuneSettings
                .Where(s => chunkIds.Contains(s.TuneSettingId))
                .ToListAsync(ct);
            if (batch.Count == 0)
            {
                continue;
            }

            foreach (var setting in batch)
            {
                if (!tuneTypeById.TryGetValue(setting.TuneId, out var tuneType))
                {
                    var owner = await db.Tunes.AsNoTracking().SingleOrDefaultAsync(t => t.TuneId == setting.TuneId, ct);
                    if (owner is null) continue;
                    tuneType = owner.TuneType;
                    tuneTypeById[setting.TuneId] = tuneType;
                }

                heuristics.ApplyFingerprint(setting, tuneType);
                settingsUpdated++;
            }
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
        }

        await LibraryStatsSupport.MarkTunesChangedAsync(db);

        return new OkObjectResult(new RecomputeResult(tunesUpdated, settingsUpdated));
    }
}
