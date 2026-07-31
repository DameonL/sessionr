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
using static SessionApp.Api.Functions.GroupFeedSupport;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/groups/{groupId} — fetch group details (members, tunes, repertoire, feed, schedules).</summary>
    [Function("GetGroup")]
    public async Task<IActionResult> GetGroup(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groups/{groupId:guid}")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var group = await db.Groups.AsNoTracking().SingleOrDefaultAsync(g => g.GroupId == groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        var viewerMembership = await db.GroupMemberships
            .AsNoTracking()
            .FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == callerUserId.Value);

        if (group.IsPrivate && viewerMembership?.Status != GroupMembershipStatus.Active)
        {
            return Forbidden("This is a private group. You must be an active member to view it.");
        }

        var isViewerAdmin = viewerMembership is { Status: GroupMembershipStatus.Active } && viewerMembership.Role.IsAdminOrOwner();

        var memberships = await db.GroupMemberships
            .AsNoTracking()
            .Include(m => m.User)
            .Where(m => m.GroupId == groupId)
            .ToListAsync();

        var activeMemberIds = memberships
            .Where(m => m.Status == GroupMembershipStatus.Active)
            .Select(m => m.UserId)
            .ToList();

        var members = memberships
            .Where(m => m.Status == GroupMembershipStatus.Active)
            .OrderBy(m => m.Role switch { GroupRole.Owner => 0, GroupRole.Administrator => 1, _ => 2 })
            .ThenBy(m => m.User.DisplayName)
            .Select(m => new GroupMemberDto(m.UserId, m.User.DisplayName, m.Role.ToString()))
            .ToList();

        var pendingMembers = isViewerAdmin
            ? memberships
                .Where(m => m.Status == GroupMembershipStatus.Pending)
                .OrderBy(m => m.JoinedAt)
                .Select(m => new GroupMemberDto(m.UserId, m.User.DisplayName, m.Role.ToString()))
                .ToList()
            : new List<GroupMemberDto>();

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

        var feed = await BuildGroupFeedAsync(db, groupId, callerUserId);

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
                    .ToList(),
                gms.Name))
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
            schedules,
            group.TimeZone ?? "UTC"
        ));
    }
}
