using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Practice.Stats;

public class Get(AppDbContext db)
{
    /// <summary>
    /// GET /api/practice/stats — streak and 30-day practice history
    /// for the dashboard.
    /// </summary>
    [Function("GetPracticeStats")]
    public async Task<IActionResult> GetPracticeStats(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "practice/stats")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var user = await db.Users
            .AsNoTracking()
            .SingleAsync(u => u.UserId == callerUserId.Value);

        var offsetMinutes = req.GetTimezoneOffsetMinutes();
        var now = DateTime.UtcNow;

        // PracticeLog references its UserTune by id only; resolve the user's UserTune ids first.
        var userTuneIds = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == callerUserId.Value)
            .Select(ut => ut.UserTuneId)
            .ToListAsync();

        if (userTuneIds.Count == 0)
        {
            return new OkObjectResult(PracticeStatsCalculator.Calculate([], now, offsetMinutes));
        }

        var rawEntries = await db.PracticeLog
            .AsNoTracking()
            .Where(p => userTuneIds.Contains(p.UserTuneId))
            .Select(p => new { p.UserTuneId, p.PracticedAt })
            .ToListAsync();

        var practiceItems = rawEntries
            .Select(p => new PracticeLogItem(p.UserTuneId, p.PracticedAt));

        var stats = PracticeStatsCalculator.Calculate(practiceItems, now, offsetMinutes);
        return new OkObjectResult(stats);
    }
}
