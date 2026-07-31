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

        var userTunes = db.UserTunes.AsNoTracking().Where(ut => ut.UserId == callerUserId.Value);

        var totalCount = await userTunes.CountAsync();

        var byStatusRows = await userTunes
            .GroupBy(ut => ut.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync();
        var byStatus = byStatusRows.ToDictionary(x => x.Status.ToString(), x => x.Count);

        var byTypeRows = await userTunes
            .GroupBy(ut => ut.Tune.TuneType)
            .Select(g => new { TuneType = g.Key, Count = g.Count() })
            .ToListAsync();
        var byType = byTypeRows.ToDictionary(x => x.TuneType.ToString(), x => x.Count);

        var rustyCutoff = DateTime.UtcNow - RustThreshold;
        var rustyCount = await userTunes
            .Where(ut => ut.Status == TuneStatus.Active
                && (ut.LastPracticed == null || ut.LastPracticed < rustyCutoff))
            .CountAsync();

        return new OkObjectResult(new RepertoireStatsDto(totalCount, byStatus, byType, rustyCount));
    }
}
