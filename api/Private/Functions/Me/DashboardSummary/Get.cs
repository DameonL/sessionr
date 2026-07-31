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
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Me.DashboardSummary;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/me/dashboard-summary — consolidated lightweight query for practice streak, group feed events, top rusty tunes, and pending group requests.</summary>
    [Function("GetDashboardSummary")]
    public async Task<IActionResult> GetDashboardSummary(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "me/dashboard-summary")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }
        var userId = callerUserId.Value;

        // 1. Practice Streak
        var user = await db.Users.AsNoTracking().Where(u => u.UserId == userId).Select(u => new { u.CurrentStreak }).FirstOrDefaultAsync();
        var currentStreakDays = user?.CurrentStreak ?? 0;

        // 2. Active group IDs for user
        var userGroupMemberships = await db.GroupMemberships
            .AsNoTracking()
            .Where(m => m.UserId == userId && m.Status == GroupMembershipStatus.Active)
            .Select(m => new { m.GroupId, m.Role })
            .ToListAsync();

        var activeGroupIds = userGroupMemberships.Select(m => m.GroupId).ToList();

        // 3. Recent Group Activity Feed (top 5)
        var recentActivity = new List<DashboardActivityFeedItemDto>();
        if (activeGroupIds.Count > 0)
        {
            var recentActivityEvents = await db.GroupFeedEvents
                .AsNoTracking()
                .Where(fe => activeGroupIds.Contains(fe.GroupId) && fe.UserId != userId)
                .OrderByDescending(fe => fe.CreatedAt)
                .Take(5)
                .Select(fe => new {
                    fe.GroupFeedEventId,
                    fe.GroupId,
                    GroupName = fe.Group.Name,
                    EventType = fe.EventType,
                    fe.Payload,
                    MemberName = fe.User.DisplayName,
                    fe.CreatedAt
                })
                .ToListAsync();

            var activityTuneTitles = await GroupFeedSupport.ResolveTuneTitlesAsync(db, recentActivityEvents.Select(fe => fe.Payload));

            recentActivity = recentActivityEvents.Select(fe => new DashboardActivityFeedItemDto(
                fe.GroupFeedEventId,
                fe.GroupId,
                fe.GroupName,
                fe.EventType.ToString(),
                GroupFeedSupport.BuildSummaryText(fe.EventType, fe.MemberName, fe.Payload, GroupFeedSupport.TitlesForEvent(fe.EventType, fe.Payload, activityTuneTitles)),
                fe.CreatedAt)).ToList();
        }

        // 4. Top Rusty Tunes (top 3)
        var rustyCutoff = DateTime.UtcNow.AddDays(-14);
        var topRustyTunes = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == userId && ut.Status == TuneStatus.Active && (ut.LastPracticed == null || ut.LastPracticed < rustyCutoff))
            .OrderBy(ut => ut.LastPracticed ?? DateTime.MinValue)
            .Take(3)
            .Select(ut => new DashboardRustyTuneDto(
                ut.UserTuneId,
                ut.Tune.Title,
                ut.Tune.TuneType.ToString(),
                ut.LastPracticed))
            .ToListAsync();

        // 5. Pending Group Join Requests for groups where caller is Owner or Administrator
        var adminGroupIds = userGroupMemberships
            .Where(m => m.Role == GroupRole.Owner || m.Role == GroupRole.Administrator)
            .Select(m => m.GroupId)
            .ToList();

        var pendingGroupRequests = adminGroupIds.Count > 0
            ? await db.GroupMemberships
                .AsNoTracking()
                .Where(m => adminGroupIds.Contains(m.GroupId) && m.Status == GroupMembershipStatus.Pending)
                .GroupBy(m => new { m.GroupId, m.Group.Name })
                .Select(g => new DashboardPendingRequestDto(g.Key.GroupId, g.Key.Name, g.Count()))
                .ToListAsync()
            : new List<DashboardPendingRequestDto>();

        // 6. Recent Friend Activity
        var friendUserIds = await db.Friendships
            .AsNoTracking()
            .Where(f => f.Status == FriendshipStatus.Accepted && (f.RequesterId == userId || f.ReceiverId == userId))
            .Select(f => f.RequesterId == userId ? f.ReceiverId : f.RequesterId)
            .ToListAsync();

        var recentFriendActivity = new List<DashboardFriendActivityDto>();
        if (friendUserIds.Count > 0)
        {
            var cutoff = DateTime.UtcNow.AddDays(-30);

            var rsvps = await db.SessionRsvps
                .AsNoTracking()
                .Where(r => friendUserIds.Contains(r.UserId) && r.RespondedAt >= cutoff)
                .Include(r => r.User)
                .Include(r => r.GroupSession)
                .ThenInclude(s => s.Group)
                .OrderByDescending(r => r.RespondedAt)
                .Take(5)
                .Select(r => new DashboardFriendActivityDto(
                    r.SessionRsvpId,
                    r.UserId,
                    r.User.DisplayName,
                    r.User.Username,
                    "SessionRsvp",
                    $"{r.User.DisplayName} is {(r.Status == RsvpStatus.Going ? "going to" : "a maybe for")} '{r.GroupSession.Title}' in {r.GroupSession.Group.Name}",
                    r.RespondedAt,
                    $"/group/{r.GroupSession.GroupId}"))
                .ToListAsync();

            var tunes = await db.UserTunes
                .AsNoTracking()
                .Where(ut => friendUserIds.Contains(ut.UserId))
                .Include(ut => ut.User)
                .Include(ut => ut.Tune)
                .OrderByDescending(ut => ut.UserTuneId)
                .Take(5)
                .Select(ut => new DashboardFriendActivityDto(
                    ut.UserTuneId,
                    ut.UserId,
                    ut.User.DisplayName,
                    ut.User.Username,
                    "TuneLearned",
                    $"{ut.User.DisplayName} added '{ut.Tune.Title}' ({ut.Tune.TuneType}) to their repertoire",
                    DateTime.UtcNow,
                    $"/tunes/{ut.TuneId}"))
                .ToListAsync();

            var badges = await db.UserBadges
                .AsNoTracking()
                .Where(b => friendUserIds.Contains(b.UserId) && b.EarnedAt >= cutoff)
                .Include(b => b.User)
                .OrderByDescending(b => b.EarnedAt)
                .Take(5)
                .Select(b => new DashboardFriendActivityDto(
                    b.UserBadgeId,
                    b.UserId,
                    b.User.DisplayName,
                    b.User.Username,
                    "BadgeEarned",
                    $"{b.User.DisplayName} earned a new badge!",
                    b.EarnedAt,
                    b.User.Username != null ? $"/profile/{b.User.Username}" : null))
                .ToListAsync();

            var friendships = await db.Friendships
                .AsNoTracking()
                .Where(f => f.Status == FriendshipStatus.Accepted && f.UpdatedAt >= cutoff && (f.RequesterId == userId || f.ReceiverId == userId))
                .Include(f => f.Requester)
                .Include(f => f.Receiver)
                .OrderByDescending(f => f.UpdatedAt)
                .Take(5)
                .Select(f => new {
                    f.FriendshipId,
                    Friend = f.RequesterId == userId ? f.Receiver : f.Requester,
                    f.UpdatedAt
                })
                .Select(f => new DashboardFriendActivityDto(
                    f.FriendshipId,
                    f.Friend.UserId,
                    f.Friend.DisplayName,
                    f.Friend.Username,
                    "NewFriend",
                    $"You and {f.Friend.DisplayName} are now friends!",
                    f.UpdatedAt,
                    f.Friend.Username != null ? $"/profile/{f.Friend.Username}" : null))
                .ToListAsync();

            recentFriendActivity = rsvps
                .Concat(tunes)
                .Concat(badges)
                .Concat(friendships)
                .OrderByDescending(a => a.CreatedAt)
                .Take(10)
                .ToList();
        }

        return new OkObjectResult(new DashboardSummaryDto(currentStreakDays, recentActivity, topRustyTunes, pendingGroupRequests, recentFriendActivity));
    }
}
