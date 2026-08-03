using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Repertoire.Stats;

public class Get(AppDbContext db)
{
    private static readonly TimeSpan RustThreshold = TimeSpan.FromDays(30);

    /// <summary>
    /// GET /api/repertoire/stats — aggregate counts (total, by status, by type, rusty)
    /// computed via SQL-translated GroupBy/Count queries, for the dashboard.
    /// </summary>
    [Function("GetRepertoireStats")]
    public async Task<IActionResult> GetRepertoireStats(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "repertoire/stats")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        // Cosmos (via EF) doesn't translate GroupBy, and byType needs the referenced Tune document, so
        // load the user's repertoire once and aggregate in memory. A personal repertoire is bounded.
        var userTunes = await db.UserTunes.AsNoTracking().Where(ut => ut.UserId == callerUserId.Value).ToListAsync();

        var totalCount = userTunes.Count;

        var byStatus = userTunes
            .GroupBy(ut => ut.Status)
            .ToDictionary(g => g.Key.ToString(), g => g.Count());

        await SetSupport.PopulateTuneAndSettingAsync(db, userTunes);
        var byType = userTunes
            .GroupBy(ut => ut.Tune.TuneType)
            .ToDictionary(g => g.Key.ToString(), g => g.Count());

        var rustyCutoff = DateTime.UtcNow - RustThreshold;
        var rustyCount = userTunes.Count(ut => ut.Status == TuneStatus.Active
            && (ut.LastPracticed == null || ut.LastPracticed < rustyCutoff));

        return new OkObjectResult(new RepertoireStatsDto(totalCount, byStatus, byType, rustyCount));
    }
}
