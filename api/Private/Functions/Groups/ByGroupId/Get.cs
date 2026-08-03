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
            .Where(m => m.GroupId == groupId)
            .ToListAsync();

        var groupTunes = await db.GroupTunes
            .AsNoTracking()
            .Where(gt => gt.GroupId == groupId)
            .ToListAsync();
        await GroupSetSupport.PopulateTuneAndSettingAsync(db, groupTunes);

        var updateEntities = await db.GroupUpdates
            .AsNoTracking()
            .Where(gu => gu.GroupId == groupId)
            .OrderByDescending(gu => gu.CreatedAt)
            .Take(50)
            .ToListAsync();

        // Display names live on separate User documents; resolve everyone referenced here in one lookup.
        var referencedUserIds = memberships.Select(m => m.UserId)
            .Concat(groupTunes.Select(gt => gt.AddedByUserId))
            .Concat(updateEntities.Select(gu => gu.CreatedByUserId))
            .Distinct()
            .ToList();
        var usersById = await db.Users
            .AsNoTracking()
            .Where(u => referencedUserIds.Contains(u.UserId))
            .ToDictionaryByIdAsync(u => u.UserId);
        string DisplayName(Guid id) => usersById.TryGetValue(id, out var u) ? u.DisplayName : "Member";

        var activeMemberIds = memberships
            .Where(m => m.Status == GroupMembershipStatus.Active)
            .Select(m => m.UserId)
            .ToList();

        var members = memberships
            .Where(m => m.Status == GroupMembershipStatus.Active)
            .OrderBy(m => m.Role switch { GroupRole.Owner => 0, GroupRole.Administrator => 1, _ => 2 })
            .ThenBy(m => DisplayName(m.UserId))
            .Select(m => new GroupMemberDto(m.UserId, DisplayName(m.UserId), m.Role.ToString()))
            .ToList();

        var pendingMembers = isViewerAdmin
            ? memberships
                .Where(m => m.Status == GroupMembershipStatus.Pending)
                .OrderBy(m => m.JoinedAt)
                .Select(m => new GroupMemberDto(m.UserId, DisplayName(m.UserId), m.Role.ToString()))
                .ToList()
            : new List<GroupMemberDto>();

        var masterTunes = groupTunes
            .OrderBy(gt => gt.Tune.Title, StringComparer.OrdinalIgnoreCase)
            .Select(gt => new GroupTuneDto(
                gt.GroupTuneId,
                gt.TuneId,
                gt.Tune.Title,
                gt.Tune.TuneType.ToString(),
                gt.TuneSetting != null ? gt.TuneSetting.Key : gt.Tune.Key,
                gt.TuneSettingId,
                gt.TuneSetting != null ? gt.TuneSetting.SubmitterName : null,
                DisplayName(gt.AddedByUserId)))
            .ToList();

        // Cosmos can't GROUP BY across the UserTune->Tune document boundary, so aggregate in memory
        // after stitching each active member tune's Tune metadata.
        var memberActiveTunes = await db.UserTunes
            .AsNoTracking()
            .Where(ut => activeMemberIds.Contains(ut.UserId) && ut.Status == TuneStatus.Active)
            .ToListAsync();
        await SetSupport.PopulateTuneAndSettingAsync(db, memberActiveTunes);

        var commonTunes = memberActiveTunes
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
            .ToList();

        var feed = await BuildGroupFeedAsync(db, groupId, callerUserId);

        var updates = updateEntities
            .Select(gu => new GroupUpdateDto(
                gu.GroupUpdateId,
                gu.GroupId,
                gu.Title,
                gu.Content,
                gu.CreatedByUserId,
                DisplayName(gu.CreatedByUserId),
                gu.CreatedAt
            ))
            .ToList();

        var scheduleEntities = await db.GroupMeetingSchedules
            .AsNoTracking()
            .Where(gms => gms.GroupId == groupId)
            .OrderBy(gms => gms.CreatedAt)
            .ToListAsync();
        var scheduleIds = scheduleEntities.Select(s => s.GroupMeetingScheduleId).ToList();
        var exceptionsBySchedule = (await db.GroupScheduleExceptions
                .AsNoTracking()
                .Where(ex => scheduleIds.Contains(ex.GroupMeetingScheduleId))
                .ToListAsync())
            .ToLookup(ex => ex.GroupMeetingScheduleId);

        var schedules = scheduleEntities
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
                exceptionsBySchedule[gms.GroupMeetingScheduleId]
                    .Select(ex => new GroupScheduleExceptionDto(ex.GroupScheduleExceptionId, ex.GroupMeetingScheduleId, ex.ExceptionDate))
                    .ToList(),
                gms.Name))
            .ToList();

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
