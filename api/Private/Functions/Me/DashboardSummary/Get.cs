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

        // 3. Recent Group Activity Feed (top 5). Group name + actor name are separate documents.
        var recentActivity = new List<DashboardActivityFeedItemDto>();
        if (activeGroupIds.Count > 0)
        {
            var recentActivityEvents = await db.GroupFeedEvents
                .AsNoTracking()
                .Where(fe => activeGroupIds.Contains(fe.GroupId) && fe.UserId != userId)
                .OrderByDescending(fe => fe.CreatedAt)
                .Take(5)
                .Select(fe => new { fe.GroupFeedEventId, fe.GroupId, fe.EventType, fe.Payload, fe.UserId, fe.CreatedAt })
                .ToListAsync();

            var actGroupIds = recentActivityEvents.Select(e => e.GroupId).Distinct().ToList();
            var actGroupNames = await db.Groups.AsNoTracking().Where(g => actGroupIds.Contains(g.GroupId)).ToDictionaryAsync(g => g.GroupId, g => g.Name);
            var actUserIds = recentActivityEvents.Select(e => e.UserId).Distinct().ToList();
            var actMemberNames = await db.Users.AsNoTracking().Where(u => actUserIds.Contains(u.UserId)).ToDictionaryAsync(u => u.UserId, u => u.DisplayName);
            var activityTuneTitles = await GroupFeedSupport.ResolveTuneTitlesAsync(db, recentActivityEvents.Select(fe => fe.Payload));

            recentActivity = recentActivityEvents.Select(fe => new DashboardActivityFeedItemDto(
                fe.GroupFeedEventId,
                fe.GroupId,
                actGroupNames.GetValueOrDefault(fe.GroupId) ?? "",
                fe.EventType.ToString(),
                GroupFeedSupport.BuildSummaryText(fe.EventType, actMemberNames.GetValueOrDefault(fe.UserId) ?? "Member", fe.Payload, GroupFeedSupport.TitlesForEvent(fe.EventType, fe.Payload, activityTuneTitles)),
                fe.CreatedAt)).ToList();
        }

        // 4. Top Rusty Tunes (top 3). Filter server-side; order/take and tune stitch in memory.
        var rustyCutoff = DateTime.UtcNow.AddDays(-14);
        var rustyCandidates = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == userId && ut.Status == TuneStatus.Active && (ut.LastPracticed == null || ut.LastPracticed < rustyCutoff))
            .ToListAsync();
        var rustyUserTunes = rustyCandidates
            .OrderBy(ut => ut.LastPracticed ?? DateTime.MinValue)
            .Take(3)
            .ToList();
        await SetSupport.PopulateTuneAndSettingAsync(db, rustyUserTunes);
        var topRustyTunes = rustyUserTunes
            .Select(ut => new DashboardRustyTuneDto(
                ut.UserTuneId,
                ut.Tune.Title,
                ut.Tune.TuneType.ToString(),
                ut.LastPracticed))
            .ToList();

        // 5. Pending Group Join Requests for groups where caller is Owner or Administrator
        var adminGroupIds = userGroupMemberships
            .Where(m => m.Role == GroupRole.Owner || m.Role == GroupRole.Administrator)
            .Select(m => m.GroupId)
            .ToList();

        var pendingGroupRequests = new List<DashboardPendingRequestDto>();
        if (adminGroupIds.Count > 0)
        {
            var pendingGroupIds = await db.GroupMemberships
                .AsNoTracking()
                .Where(m => adminGroupIds.Contains(m.GroupId) && m.Status == GroupMembershipStatus.Pending)
                .Select(m => m.GroupId)
                .ToListAsync();
            var pendingGroupNames = await db.Groups.AsNoTracking().Where(g => adminGroupIds.Contains(g.GroupId)).ToDictionaryAsync(g => g.GroupId, g => g.Name);
            pendingGroupRequests = pendingGroupIds
                .GroupBy(gid => gid)
                .Select(g => new DashboardPendingRequestDto(g.Key, pendingGroupNames.GetValueOrDefault(g.Key) ?? "", g.Count()))
                .ToList();
        }

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
            var friendUsers = await db.Users.AsNoTracking().Where(u => friendUserIds.Contains(u.UserId)).ToDictionaryByIdAsync(u => u.UserId);

            var rsvpRows = await db.SessionRsvps
                .AsNoTracking()
                .Where(r => friendUserIds.Contains(r.UserId) && r.RespondedAt >= cutoff)
                .OrderByDescending(r => r.RespondedAt)
                .Take(5)
                .ToListAsync();
            var rsvpSessionIds = rsvpRows.Select(r => r.GroupSessionId).Distinct().ToList();
            var rsvpSessions = (await db.GroupSessions.AsNoTracking().Where(s => rsvpSessionIds.Contains(s.GroupSessionId)).ToListAsync()).ToDictionary(s => s.GroupSessionId);
            var rsvpGroupIds = rsvpSessions.Values.Select(s => s.GroupId).Distinct().ToList();
            var rsvpGroupNames = await db.Groups.AsNoTracking().Where(g => rsvpGroupIds.Contains(g.GroupId)).ToDictionaryAsync(g => g.GroupId, g => g.Name);
            var rsvps = rsvpRows
                .Where(r => rsvpSessions.ContainsKey(r.GroupSessionId))
                .Select(r =>
                {
                    var s = rsvpSessions[r.GroupSessionId];
                    var friend = friendUsers.GetValueOrDefault(r.UserId);
                    return new DashboardFriendActivityDto(
                        r.SessionRsvpId,
                        r.UserId,
                        friend?.DisplayName ?? "",
                        friend?.Username,
                        "SessionRsvp",
                        $"{friend?.DisplayName} is {(r.Status == RsvpStatus.Going ? "going to" : "a maybe for")} '{s.Title}' in {(rsvpGroupNames.GetValueOrDefault(s.GroupId) ?? "")}",
                        r.RespondedAt,
                        $"/group/{s.GroupId}");
                })
                .ToList();

            var friendTuneRows = await db.UserTunes
                .AsNoTracking()
                .Where(ut => friendUserIds.Contains(ut.UserId))
                .OrderByDescending(ut => ut.UserTuneId)
                .Take(5)
                .ToListAsync();
            await SetSupport.PopulateTuneAndSettingAsync(db, friendTuneRows);
            var tunes = friendTuneRows.Select(ut =>
            {
                var friend = friendUsers.GetValueOrDefault(ut.UserId);
                return new DashboardFriendActivityDto(
                    ut.UserTuneId,
                    ut.UserId,
                    friend?.DisplayName ?? "",
                    friend?.Username,
                    "TuneLearned",
                    $"{friend?.DisplayName} added '{ut.Tune.Title}' ({ut.Tune.TuneType}) to their repertoire",
                    DateTime.UtcNow,
                    $"/tunes/{ut.TuneId}");
            }).ToList();

            var badgeRows = await db.UserBadges
                .AsNoTracking()
                .Where(b => friendUserIds.Contains(b.UserId) && b.EarnedAt >= cutoff)
                .OrderByDescending(b => b.EarnedAt)
                .Take(5)
                .ToListAsync();
            var badges = badgeRows.Select(b =>
            {
                var friend = friendUsers.GetValueOrDefault(b.UserId);
                return new DashboardFriendActivityDto(
                    b.UserBadgeId,
                    b.UserId,
                    friend?.DisplayName ?? "",
                    friend?.Username,
                    "BadgeEarned",
                    $"{friend?.DisplayName} earned a new badge!",
                    b.EarnedAt,
                    friend?.Username != null ? $"/profile/{friend.Username}" : null);
            }).ToList();

            var friendshipRows = await db.Friendships
                .AsNoTracking()
                .Where(f => f.Status == FriendshipStatus.Accepted && f.UpdatedAt >= cutoff && (f.RequesterId == userId || f.ReceiverId == userId))
                .OrderByDescending(f => f.UpdatedAt)
                .Take(5)
                .ToListAsync();
            var friendships = friendshipRows.Select(f =>
            {
                var friendId = f.RequesterId == userId ? f.ReceiverId : f.RequesterId;
                var friend = friendUsers.GetValueOrDefault(friendId);
                return new DashboardFriendActivityDto(
                    f.FriendshipId,
                    friendId,
                    friend?.DisplayName ?? "",
                    friend?.Username,
                    "NewFriend",
                    $"You and {friend?.DisplayName} are now friends!",
                    f.UpdatedAt,
                    friend?.Username != null ? $"/profile/{friend.Username}" : null);
            }).ToList();

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
