using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.GroupFeedSupport;

namespace SessionApp.Api.Functions;

/// <summary>Read-only, anonymous-friendly group endpoints (discovery + viewing public groups).</summary>
public class PublicGroupFunctions(AppDbContext db)
{
    /// <summary>GET /api/groups?userId={userId} — list all groups with user membership status.</summary>
    [Function("GetGroups")]
    public async Task<IActionResult> GetGroups(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groups")] HttpRequest req)
    {
        // Anonymous, unauthenticated route: never trust a caller-supplied userId for
        // membership/visibility decisions. Signed-in callers get the personalized view
        // from the Private app's GetGroups instead (server-verified identity).
        var userId = Guid.Empty;
        var search = req.Query["search"].ToString();

        int.TryParse(req.Query["page"], out var page);
        if (page < 1) page = 1;

        int.TryParse(req.Query["pageSize"], out var pageSize);
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 100) pageSize = 100;

        var query = db.Groups
            .AsNoTracking()
            .Where(g => !g.IsPrivate || g.Memberships.Any(m => m.UserId == userId));

        if (!string.IsNullOrWhiteSpace(search))
        {
            query = query.Where(g => EF.Functions.Like(g.Name, $"%{search}%") || (g.City != null && EF.Functions.Like(g.City, $"%{search}%")));
        }

        var totalCount = await query.CountAsync();

        var groups = await query
            .OrderBy(g => g.Name)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(g => new GroupDto(
                g.GroupId,
                g.Name,
                g.IsPrivate && !g.Memberships.Any(m => m.UserId == userId && m.Status == GroupMembershipStatus.Active) ? null : g.Description,
                g.City,
                g.Memberships.Count(m => m.Status == GroupMembershipStatus.Active),
                g.Memberships.Any(m => m.UserId == userId && m.Status == GroupMembershipStatus.Active),
                g.IsPrivate,
                g.Memberships.Any(m => m.UserId == userId && m.Status == GroupMembershipStatus.Pending)))
            .ToListAsync();

        var hasMore = (page * pageSize) < totalCount;
        return new OkObjectResult(new PagedResult<GroupDto>(groups, totalCount, page, pageSize, hasMore));
    }

    /// <summary>GET /api/groups/{groupId}?userId={userId} — fetch group dashboard details.</summary>
    [Function("GetGroupDetails")]
    public async Task<IActionResult> GetGroupDetails(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groups/{groupId:guid}")] HttpRequest req,
        Guid groupId)
    {
        // Anonymous, unauthenticated route: never trust a caller-supplied userId. Signed-in
        // callers get the member-aware view from the Private app's GetGroupDetails instead.
        var userId = Guid.Empty;

        var group = await db.Groups
            .Include(g => g.Memberships).ThenInclude(m => m.User)
            .AsSplitQuery()
            .SingleOrDefaultAsync(g => g.GroupId == groupId);

        if (group is null)
        {
            return new NotFoundResult();
        }

        var viewerMembership = group.Memberships.FirstOrDefault(m => m.UserId == userId);
        var viewerIsActive = viewerMembership is { Status: GroupMembershipStatus.Active };

        // Private groups reveal nothing but their name/privacy flag and the viewer's own
        // request status to non-members and members still awaiting approval.
        if (group.IsPrivate && !viewerIsActive)
        {
            return new OkObjectResult(new GroupDetailsDto(
                group.GroupId, group.Name, null, group.City, true, null, viewerMembership?.Status.ToString(),
                [], [], [], [], [], [], []));
        }

        var isViewerAdmin = viewerIsActive && viewerMembership!.Role.IsAdminOrOwner();

        var activeMemberIds = group.Memberships
            .Where(m => m.Status == GroupMembershipStatus.Active)
            .Select(m => m.UserId)
            .ToList();

        // 1. Members list, owner/admins first
        var members = group.Memberships
            .Where(m => m.Status == GroupMembershipStatus.Active)
            .OrderBy(m => m.Role switch { GroupRole.Owner => 0, GroupRole.Administrator => 1, _ => 2 })
            .ThenBy(m => m.User.DisplayName)
            .Select(m => new GroupMemberDto(m.UserId, m.User.DisplayName, m.User.Email, m.Role.ToString()))
            .ToList();

        // 2. Pending join requests awaiting admin approval
        var pendingMembers = group.Memberships
            .Where(m => m.Status == GroupMembershipStatus.Pending)
            .OrderBy(m => m.JoinedAt)
            .Select(m => new GroupMemberDto(m.UserId, m.User.DisplayName, m.User.Email, m.Role.ToString()))
            .ToList();

        // 3. Master tune list curated by admins/owner
        var masterTunes = await db.GroupTunes
            .AsNoTracking()
            .Where(gt => gt.GroupId == groupId)
            .OrderBy(gt => gt.Tune.Title)
            .Select(gt => new GroupTuneDto(
                gt.GroupTuneId,
                gt.TuneId,
                gt.Tune.Title,
                gt.Tune.TuneType.ToString(),
                gt.TuneSetting != null ? gt.TuneSetting.Key : gt.Tune.Key,
                gt.TuneSettingId,
                gt.TuneSetting != null ? gt.TuneSetting.SubmitterName : null,
                gt.AddedByUser.DisplayName))
            .ToListAsync();

        // 4. Shared Repertoire (Common Tunes)
        // Find tunes known by group members, ordered by member count descending. Only counts
        // tunes a member has marked Active — Wishlist/Learning/Rusty/Retired don't reflect
        // tunes they can actually play together at a session.
        var commonTunes = await db.UserTunes
            .AsNoTracking()
            .Where(ut => activeMemberIds.Contains(ut.UserId) && ut.Status == TuneStatus.Active)
            .GroupBy(ut => new { ut.TuneId, ut.Tune.Title, ut.Tune.TuneType, ut.Tune.Key })
            .OrderByDescending(g => g.Count())
            .ThenBy(g => g.Key.Title)
            .Take(40)
            .Select(g => new GroupCommonTuneDto(
                g.Key.TuneId,
                g.Key.Title,
                g.Key.TuneType.ToString(),
                g.Key.Key,
                g.Count(),
                activeMemberIds.Count
            ))
            .ToListAsync();

        // 5. Activity feed: system-generated events (tunes learned, members joined), persisted
        // as permanent history — not re-derived live from current membership.
        var feed = await BuildGroupFeedAsync(db, groupId);

        // 6. Admin updates / announcements feed
        var updates = await db.GroupUpdates
            .AsNoTracking()
            .Where(gu => gu.GroupId == groupId)
            .OrderByDescending(gu => gu.CreatedAt)
            .Take(50)
            .Select(gu => new GroupUpdateDto(
                gu.GroupUpdateId,
                gu.GroupId,
                gu.Title,
                gu.Content,
                gu.CreatedByUserId,
                gu.CreatedByUser.DisplayName,
                gu.CreatedAt
            ))
            .ToListAsync();

        // 7. Group meeting schedules (multiple recurring schedules)
        var schedules = await db.GroupMeetingSchedules
            .AsNoTracking()
            .Include(gms => gms.Exceptions)
            .Where(gms => gms.GroupId == groupId)
            .OrderBy(gms => gms.CreatedAt)
            .Select(gms => new GroupMeetingScheduleDto(
                gms.GroupMeetingScheduleId,
                gms.GroupId,
                gms.RecurrencePattern,
                gms.RecurrenceDayOfWeek,
                gms.RecurrenceWeekOfMonth,
                gms.StartDate,
                gms.MeetingTime,
                gms.MeetingScheduleText,
                gms.MeetingDescription,
                gms.Exceptions
                    .Select(ex => new GroupScheduleExceptionDto(ex.GroupScheduleExceptionId, ex.GroupMeetingScheduleId, ex.ExceptionDate))
                    .ToList()))
            .ToListAsync();

        return new OkObjectResult(new GroupDetailsDto(
            group.GroupId,
            group.Name,
            group.Description,
            group.City,
            group.IsPrivate,
            isViewerAdmin ? group.InviteCode : null,
            viewerMembership?.Status.ToString(),
            members,
            pendingMembers,
            masterTunes,
            commonTunes,
            feed,
            updates,
            schedules
        ));
    }
}
