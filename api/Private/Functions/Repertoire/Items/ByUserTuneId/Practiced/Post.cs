using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Repertoire.Items.ByUserTuneId.Practiced;

public class Post(AppDbContext db, GamificationService gamification)
{
    /// <summary>POST /api/repertoire/items/{userTuneId}/practiced — log a practice event for a tune.</summary>
    [Function("MarkPracticed")]
    public async Task<IActionResult> MarkPracticed(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "repertoire/items/{userTuneId:guid}/practiced")] HttpRequest req,
        Guid userTuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var userTune = await db.UserTunes
            .SingleOrDefaultAsync(ut => ut.UserTuneId == userTuneId && ut.UserId == callerUserId.Value);

        if (userTune is null)
        {
            return new NotFoundResult();
        }

        var user = await db.Users.SingleOrDefaultAsync(u => u.UserId == callerUserId.Value);
        if (user is null)
        {
            return new NotFoundResult();
        }

        var offsetMinutes = req.GetTimezoneOffsetMinutes();
        var now = DateTime.UtcNow;
        userTune.LastPracticed = now;

        var localToday = now.AddMinutes(-offsetMinutes).Date;

        db.PracticeLog.Add(new PracticeLogEntry
        {
            UserTuneId = userTuneId,
            PracticedAt = now
        });

        // PracticeLog references its UserTune by id only (Cosmos can't join), so resolve the user's
        // UserTune ids first, then read their practice timestamps.
        var userTuneIds = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == callerUserId.Value)
            .Select(ut => ut.UserTuneId)
            .ToListAsync();

        var allTimestamps = userTuneIds.Count == 0
            ? new System.Collections.Generic.List<DateTime>()
            : await db.PracticeLog
                .AsNoTracking()
                .Where(p => userTuneIds.Contains(p.UserTuneId))
                .Select(p => p.PracticedAt)
                .ToListAsync();

        allTimestamps.Add(now);

        var computedStreak = PracticeStreakCalculator.ComputeCurrentStreak(allTimestamps, now, offsetMinutes);
        user.CurrentStreak = computedStreak;
        user.StreakAnchorDate = localToday;

        var sourceId = $"{userTuneId}:{localToday:yyyy-MM-dd}";
        var newBadges = await gamification.AwardPointsAsync(callerUserId.Value, PointsReason.PracticeLogged, sourceId, user, saveImmediately: false);

        await db.SaveChangesAsync();

        foreach (var badgeKey in newBadges)
        {
            if (GamificationService.TryGetStreakDays(badgeKey, out var days))
            {
                await GroupFeedSupport.RecordUserMilestoneAsync(db, callerUserId.Value, GroupFeedEventType.StreakMilestone, new StreakMilestonePayload(days));
            }
            else
            {
                await GroupFeedSupport.RecordUserMilestoneAsync(db, callerUserId.Value, GroupFeedEventType.BadgeEarned, new BadgeEarnedPayload(badgeKey, GamificationService.BadgeLabel(badgeKey)));
            }
        }

        return new OkObjectResult(new MarkPracticedResponseDto(userTune.UserTuneId, userTune.LastPracticed, newBadges.ToList()));
    }
}
