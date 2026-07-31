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
                    .Select(fe => new {
                        fe.GroupFeedEventId,
                        fe.GroupId,
                        GroupName = fe.Group.Name,
                        EventType = fe.EventType,
                        fe.Payload,
                        MemberName = fe.User.DisplayName,
                        MemberUsername = fe.User.Username,
                        fe.CreatedAt
                    })
                    .ToListAsync();

                var activityTuneTitles = await GroupFeedSupport.ResolveTuneTitlesAsync(db, groupEvents.Select(fe => fe.Payload));

                items.AddRange(groupEvents.Select(fe => new DashboardActivityItemDto(
                    fe.GroupFeedEventId,
                    "Group",
                    fe.EventType.ToString(),
                    GroupFeedSupport.BuildSummaryText(fe.EventType, fe.MemberName, fe.Payload, GroupFeedSupport.TitlesForEvent(fe.EventType, fe.Payload, activityTuneTitles)),
                    fe.CreatedAt,
                    fe.MemberName,
                    fe.MemberUsername,
                    fe.GroupId,
                    fe.GroupName,
                    $"/group/{fe.GroupId}")));
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

                var rsvps = await db.SessionRsvps
                    .AsNoTracking()
                    .Where(r => friendUserIds.Contains(r.UserId) && r.RespondedAt >= cutoff)
                    .Include(r => r.User)
                    .Include(r => r.GroupSession)
                    .ThenInclude(s => s.Group)
                    .OrderByDescending(r => r.RespondedAt)
                    .Take(50)
                    .Select(r => new DashboardActivityItemDto(
                        r.SessionRsvpId,
                        "Friend",
                        "SessionRsvp",
                        $"{r.User.DisplayName} is {(r.Status == RsvpStatus.Going ? "going to" : "a maybe for")} '{r.GroupSession.Title}' in {r.GroupSession.Group.Name}",
                        r.RespondedAt,
                        r.User.DisplayName,
                        r.User.Username,
                        r.GroupSession.GroupId,
                        r.GroupSession.Group.Name,
                        $"/group/{r.GroupSession.GroupId}"))
                    .ToListAsync();

                var tunes = await db.UserTunes
                    .AsNoTracking()
                    .Where(ut => friendUserIds.Contains(ut.UserId))
                    .Include(ut => ut.User)
                    .Include(ut => ut.Tune)
                    .OrderByDescending(ut => ut.UserTuneId)
                    .Take(50)
                    .Select(ut => new DashboardActivityItemDto(
                        ut.UserTuneId,
                        "Friend",
                        "TuneLearned",
                        $"{ut.User.DisplayName} added '{ut.Tune.Title}' ({ut.Tune.TuneType}) to their repertoire",
                        DateTime.UtcNow,
                        ut.User.DisplayName,
                        ut.User.Username,
                        null,
                        null,
                        $"/tunes/{ut.TuneId}"))
                    .ToListAsync();

                var badges = await db.UserBadges
                    .AsNoTracking()
                    .Where(b => friendUserIds.Contains(b.UserId) && b.EarnedAt >= cutoff)
                    .Include(b => b.User)
                    .OrderByDescending(b => b.EarnedAt)
                    .Take(50)
                    .Select(b => new DashboardActivityItemDto(
                        b.UserBadgeId,
                        "Friend",
                        "BadgeEarned",
                        $"{b.User.DisplayName} earned a new badge!",
                        b.EarnedAt,
                        b.User.DisplayName,
                        b.User.Username,
                        null,
                        null,
                        b.User.Username != null ? $"/profile/{b.User.Username}" : null))
                    .ToListAsync();

                var friendships = await db.Friendships
                    .AsNoTracking()
                    .Where(f => f.Status == FriendshipStatus.Accepted && f.UpdatedAt >= cutoff && (f.RequesterId == userId || f.ReceiverId == userId))
                    .Include(f => f.Requester)
                    .Include(f => f.Receiver)
                    .OrderByDescending(f => f.UpdatedAt)
                    .Take(50)
                    .Select(f => new {
                        f.FriendshipId,
                        Friend = f.RequesterId == userId ? f.Receiver : f.Requester,
                        f.UpdatedAt
                    })
                    .Select(f => new DashboardActivityItemDto(
                        f.FriendshipId,
                        "Friend",
                        "NewFriend",
                        $"You and {f.Friend.DisplayName} are now friends!",
                        f.UpdatedAt,
                        f.Friend.DisplayName,
                        f.Friend.Username,
                        null,
                        null,
                        f.Friend.Username != null ? $"/profile/{f.Friend.Username}" : null))
                    .ToListAsync();

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
