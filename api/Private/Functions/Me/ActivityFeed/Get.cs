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

namespace SessionApp.Api.Functions.Me.ActivityFeed;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/me/activity-feed — paginated unified activity feed combining group and friend events.</summary>
    [Function("GetActivityFeed")]
    public async Task<IActionResult> GetActivityFeed(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "me/activity-feed")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }
        var userId = callerUserId.Value;

        var filter = req.Query["filter"].ToString()?.ToLowerInvariant() ?? "all";
        int.TryParse(req.Query["page"], out var page);
        if (page < 1) page = 1;
        int.TryParse(req.Query["pageSize"], out var pageSize);
        if (pageSize < 1 || pageSize > 100) pageSize = 20;

        var items = new List<DashboardActivityItemDto>();

        // 1. Fetch group feed events if filter is "all" or "groups"
        if (filter == "all" || filter == "groups")
        {
            var activeGroupIds = await db.GroupMemberships
                .AsNoTracking()
                .Where(m => m.UserId == userId && m.Status == GroupMembershipStatus.Active)
                .Select(m => m.GroupId)
                .ToListAsync();

            if (activeGroupIds.Count > 0)
            {
                var groupEvents = await db.GroupFeedEvents
                    .AsNoTracking()
                    .Where(fe => activeGroupIds.Contains(fe.GroupId) && fe.UserId != userId)
                    .OrderByDescending(fe => fe.CreatedAt)
                    .Take(150) // fetch upper bound pool to merge
                    .Select(fe => new { fe.GroupFeedEventId, fe.GroupId, fe.EventType, fe.Payload, fe.UserId, fe.CreatedAt })
                    .ToListAsync();

                // Group name + actor name/username are separate documents — resolve by id.
                var geGroupIds = groupEvents.Select(e => e.GroupId).Distinct().ToList();
                var geGroupNames = await db.Groups.AsNoTracking().Where(g => geGroupIds.Contains(g.GroupId)).ToDictionaryAsync(g => g.GroupId, g => g.Name);
                var geUserIds = groupEvents.Select(e => e.UserId).Distinct().ToList();
                var geUsers = await db.Users.AsNoTracking().Where(u => geUserIds.Contains(u.UserId)).ToDictionaryByIdAsync(u => u.UserId);
                var activityTuneTitles = await GroupFeedSupport.ResolveTuneTitlesAsync(db, groupEvents.Select(fe => fe.Payload));

                items.AddRange(groupEvents.Select(fe =>
                {
                    var actor = geUsers.GetValueOrDefault(fe.UserId);
                    var memberName = actor?.DisplayName ?? "Member";
                    return new DashboardActivityItemDto(
                        fe.GroupFeedEventId,
                        "Group",
                        fe.EventType.ToString(),
                        GroupFeedSupport.BuildSummaryText(fe.EventType, memberName, fe.Payload, GroupFeedSupport.TitlesForEvent(fe.EventType, fe.Payload, activityTuneTitles)),
                        fe.CreatedAt,
                        memberName,
                        actor?.Username,
                        fe.GroupId,
                        geGroupNames.GetValueOrDefault(fe.GroupId) ?? "",
                        $"/group/{fe.GroupId}");
                }));
            }
        }

        // 2. Fetch friend activity if filter is "all" or "friends"
        if (filter == "all" || filter == "friends")
        {
            var friendUserIds = await db.Friendships
                .AsNoTracking()
                .Where(f => f.Status == FriendshipStatus.Accepted && (f.RequesterId == userId || f.ReceiverId == userId))
                .Select(f => f.RequesterId == userId ? f.ReceiverId : f.RequesterId)
                .ToListAsync();

            if (friendUserIds.Count > 0)
            {
                var cutoff = DateTime.UtcNow.AddDays(-60);
                var friendUsers = await db.Users.AsNoTracking().Where(u => friendUserIds.Contains(u.UserId)).ToDictionaryByIdAsync(u => u.UserId);

                var rsvpRows = await db.SessionRsvps
                    .AsNoTracking()
                    .Where(r => friendUserIds.Contains(r.UserId) && r.RespondedAt >= cutoff)
                    .OrderByDescending(r => r.RespondedAt)
                    .Take(50)
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
                        var groupName = rsvpGroupNames.GetValueOrDefault(s.GroupId) ?? "";
                        return new DashboardActivityItemDto(
                            r.SessionRsvpId,
                            "Friend",
                            "SessionRsvp",
                            $"{friend?.DisplayName} is {(r.Status == RsvpStatus.Going ? "going to" : "a maybe for")} '{s.Title}' in {groupName}",
                            r.RespondedAt,
                            friend?.DisplayName ?? "",
                            friend?.Username,
                            s.GroupId,
                            groupName,
                            $"/group/{s.GroupId}");
                    })
                    .ToList();

                var friendTuneRows = await db.UserTunes
                    .AsNoTracking()
                    .Where(ut => friendUserIds.Contains(ut.UserId))
                    .OrderByDescending(ut => ut.UserTuneId)
                    .Take(50)
                    .ToListAsync();
                await SetSupport.PopulateTuneAndSettingAsync(db, friendTuneRows);
                var tunes = friendTuneRows.Select(ut =>
                {
                    var friend = friendUsers.GetValueOrDefault(ut.UserId);
                    return new DashboardActivityItemDto(
                        ut.UserTuneId,
                        "Friend",
                        "TuneLearned",
                        $"{friend?.DisplayName} added '{ut.Tune.Title}' ({ut.Tune.TuneType}) to their repertoire",
                        DateTime.UtcNow,
                        friend?.DisplayName ?? "",
                        friend?.Username,
                        null,
                        null,
                        $"/tunes/{ut.TuneId}");
                }).ToList();

                var badgeRows = await db.UserBadges
                    .AsNoTracking()
                    .Where(b => friendUserIds.Contains(b.UserId) && b.EarnedAt >= cutoff)
                    .OrderByDescending(b => b.EarnedAt)
                    .Take(50)
                    .ToListAsync();
                var badges = badgeRows.Select(b =>
                {
                    var friend = friendUsers.GetValueOrDefault(b.UserId);
                    return new DashboardActivityItemDto(
                        b.UserBadgeId,
                        "Friend",
                        "BadgeEarned",
                        $"{friend?.DisplayName} earned a new badge!",
                        b.EarnedAt,
                        friend?.DisplayName ?? "",
                        friend?.Username,
                        null,
                        null,
                        friend?.Username != null ? $"/profile/{friend.Username}" : null);
                }).ToList();

                var friendshipRows = await db.Friendships
                    .AsNoTracking()
                    .Where(f => f.Status == FriendshipStatus.Accepted && f.UpdatedAt >= cutoff && (f.RequesterId == userId || f.ReceiverId == userId))
                    .OrderByDescending(f => f.UpdatedAt)
                    .Take(50)
                    .ToListAsync();
                var friendships = friendshipRows.Select(f =>
                {
                    var friendId = f.RequesterId == userId ? f.ReceiverId : f.RequesterId;
                    var friend = friendUsers.GetValueOrDefault(friendId);
                    return new DashboardActivityItemDto(
                        f.FriendshipId,
                        "Friend",
                        "NewFriend",
                        $"You and {friend?.DisplayName} are now friends!",
                        f.UpdatedAt,
                        friend?.DisplayName ?? "",
                        friend?.Username,
                        null,
                        null,
                        friend?.Username != null ? $"/profile/{friend.Username}" : null);
                }).ToList();

                items.AddRange(rsvps);
                items.AddRange(tunes);
                items.AddRange(badges);
                items.AddRange(friendships);
            }
        }

        // 3. Sort merged activity stream chronologically descending
        var sorted = items.OrderByDescending(i => i.CreatedAt).ToList();
        var totalCount = sorted.Count;
        var pagedItems = sorted.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        var hasMore = (page * pageSize) < totalCount;

        return new OkObjectResult(new PagedResult<DashboardActivityItemDto>(pagedItems, totalCount, page, pageSize, hasMore));
    }
}
