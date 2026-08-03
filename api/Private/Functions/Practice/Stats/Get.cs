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
        var localToday = now.AddMinutes(-offsetMinutes).Date;
        var localWindowStart = localToday.AddDays(-29);

        // PracticeLog references its UserTune by id only; resolve the user's UserTune ids first.
        var userTuneIds = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == callerUserId.Value)
            .Select(ut => ut.UserTuneId)
            .ToListAsync();
        var allPracticeTimestamps = await db.PracticeLog
            .AsNoTracking()
            .Where(p => userTuneIds.Contains(p.UserTuneId))
            .Select(p => p.PracticedAt)
            .ToListAsync();

        var streak = PracticeStreakCalculator.ComputeCurrentStreak(allPracticeTimestamps, now, offsetMinutes);

        var countsInWindow = allPracticeTimestamps
            .Select(d => d.AddMinutes(-offsetMinutes).Date)
            .Where(d => d >= localWindowStart && d <= localToday)
            .GroupBy(d => d)
            .ToDictionary(g => g.Key, g => g.Count());

        var perDay = Enumerable.Range(0, 30)
            .Select(offset =>
            {
                var day = localWindowStart.AddDays(offset);
                return new PracticeDayDto(day.ToString("yyyy-MM-dd"), countsInWindow.GetValueOrDefault(day));
            })
            .ToList();

        return new OkObjectResult(new PracticeStatsDto(streak, countsInWindow.Values.Sum(), perDay));
    }
}
