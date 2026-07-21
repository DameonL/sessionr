using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.GroupAuthorization;

namespace SessionApp.Api.Functions;

/// <summary>Group membership, roles, privacy, and master-tune-list mutations — all require an authenticated actor.</summary>
public class PrivateGroupFunctions(AppDbContext db)
{
    /// <summary>POST /api/groups — create a new group. The creator becomes its owner.</summary>
    [Function("CreateGroup")]
    public async Task<IActionResult> CreateGroup(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<CreateGroupRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Name))
        {
            return new BadRequestObjectResult("Group name is required.");
        }
        if (string.IsNullOrWhiteSpace(body.Description))
        {
            return new BadRequestObjectResult("Group description is required.");
        }

        var user = await db.Users.FindAsync(callerUserId.Value);
        if (user is null)
        {
            return new NotFoundObjectResult($"User {callerUserId.Value} not found.");
        }

        var group = new Group
        {
            Name = body.Name.Trim(),
            Description = body.Description.Trim(),
            City = string.IsNullOrWhiteSpace(body.City) ? null : body.City.Trim(),
            IsPrivate = body.IsPrivate,
            InviteCode = GenerateInviteCode()
        };

        if (body.Schedules != null && body.Schedules.Count > 0)
        {
            foreach (var s in body.Schedules)
            {
                if (s.RecurrencePattern != RecurrencePattern.None)
                {
                    group.Schedules.Add(new GroupMeetingSchedule
                    {
                        Group = group,
                        RecurrencePattern = s.RecurrencePattern,
                        RecurrenceDayOfWeek = s.RecurrenceDayOfWeek,
                        RecurrenceWeekOfMonth = s.RecurrenceWeekOfMonth,
                        StartDate = s.StartDate,
                        MeetingTime = s.MeetingTime?.Trim(),
                        MeetingScheduleText = s.MeetingScheduleText?.Trim(),
                        MeetingDescription = s.MeetingDescription?.Trim()
                    });
                }
            }
        }
        else if (body.RecurrencePattern != RecurrencePattern.None)
        {
            group.Schedules.Add(new GroupMeetingSchedule
            {
                Group = group,
                RecurrencePattern = body.RecurrencePattern,
                RecurrenceDayOfWeek = body.RecurrenceDayOfWeek,
                RecurrenceWeekOfMonth = body.RecurrenceWeekOfMonth,
                StartDate = body.StartDate,
                MeetingTime = body.MeetingTime?.Trim(),
                MeetingScheduleText = body.MeetingScheduleText?.Trim(),
                MeetingDescription = body.MeetingDescription?.Trim()
            });
        }

        db.Groups.Add(group);
        db.GroupMemberships.Add(new GroupMembership
        {
            Group = group,
            User = user,
            Role = GroupRole.Owner
        });

        await db.SaveChangesAsync();

        return new OkObjectResult(new GroupDto(
            group.GroupId,
            group.Name,
            group.Description,
            group.City,
            1,
            true,
            group.IsPrivate,
            false));
    }

    /// <summary>POST /api/groups/{groupId}/updates — admins/owner post group updates/announcements.</summary>
    [Function("CreateGroupUpdate")]
    public async Task<IActionResult> CreateGroupUpdate(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/updates")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<CreateGroupUpdateRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Title) || string.IsNullOrWhiteSpace(body.Content))
        {
            return new BadRequestObjectResult("Title and Content are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole is not (GroupRole.Administrator or GroupRole.Owner))
        {
            return Forbidden("Only group administrators can post updates.");
        }

        var update = new GroupUpdate
        {
            GroupId = groupId,
            Title = body.Title.Trim(),
            Content = body.Content.Trim(),
            CreatedByUserId = callerUserId.Value,
        };
        db.GroupUpdates.Add(update);
        await db.SaveChangesAsync();

        var user = await db.Users.FindAsync(callerUserId.Value);

        return new OkObjectResult(new GroupUpdateDto(
            update.GroupUpdateId,
            update.GroupId,
            update.Title,
            update.Content,
            update.CreatedByUserId,
            user?.DisplayName ?? "Admin",
            update.CreatedAt));
    }

    /// <summary>DELETE /api/groups/{groupId}/updates/{updateId} — admins/owner delete updates.</summary>
    [Function("DeleteGroupUpdate")]
    public async Task<IActionResult> DeleteGroupUpdate(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/updates/{updateId:guid}")] HttpRequest req,
        Guid groupId, Guid updateId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole is not (GroupRole.Administrator or GroupRole.Owner))
        {
            return Forbidden("Only group administrators can delete updates.");
        }

        var update = await db.GroupUpdates.SingleOrDefaultAsync(u => u.GroupUpdateId == updateId && u.GroupId == groupId);
        if (update is null)
        {
            return new NotFoundResult();
        }

        db.GroupUpdates.Remove(update);
        await db.SaveChangesAsync();

        return new OkResult();
    }

    /// <summary>POST /api/groups/{groupId}/schedule — admins/owner update recurring schedule.</summary>
    [Function("UpdateGroupSchedule")]
    public async Task<IActionResult> UpdateGroupSchedule(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/schedule")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<UpdateGroupScheduleRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request body is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole is not (GroupRole.Administrator or GroupRole.Owner))
        {
            return Forbidden("Only group administrators can update the meeting schedule.");
        }

        var schedule = await db.GroupMeetingSchedules.FirstOrDefaultAsync(s => s.GroupId == groupId);
        if (schedule == null)
        {
            schedule = new GroupMeetingSchedule { GroupId = groupId };
            db.GroupMeetingSchedules.Add(schedule);
        }

        schedule.RecurrencePattern = body.RecurrencePattern;
        schedule.RecurrenceDayOfWeek = body.RecurrenceDayOfWeek;
        schedule.RecurrenceWeekOfMonth = body.RecurrenceWeekOfMonth;
        schedule.StartDate = body.StartDate;
        schedule.MeetingTime = body.MeetingTime?.Trim();
        schedule.MeetingScheduleText = body.MeetingScheduleText?.Trim();
        schedule.MeetingDescription = body.MeetingDescription?.Trim();

        await db.SaveChangesAsync();

        return new OkObjectResult(schedule);
    }

    /// <summary>POST /api/groups/{groupId}/schedules — admins/owner add a recurring meeting schedule.</summary>
    [Function("AddGroupSchedule")]
    public async Task<IActionResult> AddGroupSchedule(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/schedules")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<CreateGroupScheduleRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request body is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole is not (GroupRole.Administrator or GroupRole.Owner))
        {
            return Forbidden("Only group administrators can add meeting schedules.");
        }

        var schedule = new GroupMeetingSchedule
        {
            GroupId = groupId,
            RecurrencePattern = body.RecurrencePattern,
            RecurrenceDayOfWeek = body.RecurrenceDayOfWeek,
            RecurrenceWeekOfMonth = body.RecurrenceWeekOfMonth,
            StartDate = body.StartDate,
            MeetingTime = body.MeetingTime?.Trim(),
            MeetingScheduleText = body.MeetingScheduleText?.Trim(),
            MeetingDescription = body.MeetingDescription?.Trim()
        };
        db.GroupMeetingSchedules.Add(schedule);

        await db.SaveChangesAsync();

        return new OkObjectResult(new GroupMeetingScheduleDto(
            schedule.GroupMeetingScheduleId,
            schedule.GroupId,
            schedule.RecurrencePattern,
            schedule.RecurrenceDayOfWeek,
            schedule.RecurrenceWeekOfMonth,
            schedule.StartDate,
            schedule.MeetingTime,
            schedule.MeetingScheduleText,
            schedule.MeetingDescription));
    }

    /// <summary>DELETE /api/groups/{groupId}/schedules/{scheduleId} — admins/owner delete a schedule.</summary>
    [Function("DeleteGroupSchedule")]
    public async Task<IActionResult> DeleteGroupSchedule(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/schedules/{scheduleId:guid}")] HttpRequest req,
        Guid groupId, Guid scheduleId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole is not (GroupRole.Administrator or GroupRole.Owner))
        {
            return Forbidden("Only group administrators can delete meeting schedules.");
        }

        var schedule = await db.GroupMeetingSchedules.SingleOrDefaultAsync(s => s.GroupMeetingScheduleId == scheduleId && s.GroupId == groupId);
        if (schedule is null)
        {
            return new NotFoundResult();
        }

        db.GroupMeetingSchedules.Remove(schedule);
        await db.SaveChangesAsync();

        return new OkResult();
    }

    /// <summary>POST /api/groups/{groupId}/info — admins/owner update group general details.</summary>
    [Function("UpdateGroupInfo")]
    public async Task<IActionResult> UpdateGroupInfo(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/info")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<UpdateGroupInfoRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Name) || string.IsNullOrWhiteSpace(body.Description))
        {
            return new BadRequestObjectResult("Name and Description are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole is not (GroupRole.Administrator or GroupRole.Owner))
        {
            return Forbidden("Only group administrators can update group settings.");
        }

        var group = await db.Groups.FindAsync(groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        group.Name = body.Name.Trim();
        group.Description = body.Description.Trim();
        group.City = string.IsNullOrWhiteSpace(body.City) ? null : body.City.Trim();
        group.IsPrivate = body.IsPrivate;

        await db.SaveChangesAsync();

        return new OkObjectResult(group);
    }

    /// <summary>POST /api/groups/{groupId}/schedules/replace — admins/owner batch replace group meeting schedules.</summary>
    [Function("ReplaceGroupSchedules")]
    public async Task<IActionResult> ReplaceGroupSchedules(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/schedules/replace")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<ReplaceGroupSchedulesRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request payload is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole is not (GroupRole.Administrator or GroupRole.Owner))
        {
            return Forbidden("Only group administrators can update meeting schedules.");
        }

        var existingSchedules = await db.GroupMeetingSchedules.Where(s => s.GroupId == groupId).ToListAsync();
        db.GroupMeetingSchedules.RemoveRange(existingSchedules);

        if (body.Schedules != null && body.Schedules.Count > 0)
        {
            foreach (var s in body.Schedules)
            {
                if (s.RecurrencePattern != RecurrencePattern.None)
                {
                    db.GroupMeetingSchedules.Add(new GroupMeetingSchedule
                    {
                        GroupId = groupId,
                        RecurrencePattern = s.RecurrencePattern,
                        RecurrenceDayOfWeek = s.RecurrenceDayOfWeek,
                        RecurrenceWeekOfMonth = s.RecurrenceWeekOfMonth,
                        StartDate = s.StartDate,
                        MeetingTime = s.MeetingTime?.Trim(),
                        MeetingScheduleText = s.MeetingScheduleText?.Trim(),
                        MeetingDescription = s.MeetingDescription?.Trim()
                    });
                }
            }
        }

        await db.SaveChangesAsync();

        return new OkResult();
    }

    /// <summary>
    /// POST /api/groups/{groupId}/join — join a public group instantly, or a private
    /// group either instantly (with a valid invite code) or as a pending request
    /// awaiting admin approval (without one).
    /// </summary>
    [Function("JoinGroup")]
    public async Task<IActionResult> JoinGroup(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/join")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<JoinGroupRequest>();

        var group = await db.Groups.FindAsync(groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        var user = await db.Users.FindAsync(callerUserId.Value);
        if (user is null)
        {
            return new NotFoundObjectResult($"User {callerUserId.Value} not found.");
        }

        var existing = await db.GroupMemberships.SingleOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == callerUserId.Value);
        if (existing is not null)
        {
            return new ConflictObjectResult(existing.Status == GroupMembershipStatus.Pending
                ? "Your request to join is already pending approval."
                : "User is already a member of this group.");
        }

        var inviteCode = body?.InviteCode;
        var codeValid = group.IsPrivate
            && !string.IsNullOrWhiteSpace(inviteCode)
            && string.Equals(inviteCode.Trim(), group.InviteCode, StringComparison.OrdinalIgnoreCase);

        var status = !group.IsPrivate || codeValid ? GroupMembershipStatus.Active : GroupMembershipStatus.Pending;

        db.GroupMemberships.Add(new GroupMembership
        {
            GroupId = groupId,
            UserId = callerUserId.Value,
            Role = GroupRole.Member,
            Status = status
        });
        await db.SaveChangesAsync();

        return new OkObjectResult(new JoinResultDto(status.ToString()));
    }

    /// <summary>
    /// POST /api/groups/{groupId}/leave — leave a group. The owner must transfer
    /// ownership first unless they are the only remaining member, in which case
    /// leaving deletes the group.
    /// </summary>
    [Function("LeaveGroup")]
    public async Task<IActionResult> LeaveGroup(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/leave")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var group = await db.Groups.Include(g => g.Memberships).SingleOrDefaultAsync(g => g.GroupId == groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        var membership = group.Memberships.FirstOrDefault(m => m.UserId == callerUserId.Value);
        if (membership is null)
        {
            return new NotFoundObjectResult("User is not a member of this group.");
        }

        var otherActiveMembers = group.Memberships.Count(m => m.Status == GroupMembershipStatus.Active && m.UserId != callerUserId.Value);

        if (membership.Role == GroupRole.Owner && membership.Status == GroupMembershipStatus.Active && otherActiveMembers > 0)
        {
            return new BadRequestObjectResult("Transfer group ownership to another member before leaving.");
        }

        db.GroupMemberships.Remove(membership);

        if (otherActiveMembers == 0)
        {
            db.Groups.Remove(group);
        }

        await db.SaveChangesAsync();

        return new OkResult();
    }

    /// <summary>
    /// DELETE /api/groups/{groupId}/members/{targetUserId} — remove a member.
    /// Administrators may remove regular members; only the owner may remove administrators.
    /// Nobody can remove the owner or themselves this way (use transfer-ownership / leave instead).
    /// </summary>
    [Function("RemoveGroupMember")]
    public async Task<IActionResult> RemoveGroupMember(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/members/{targetUserId:guid}")] HttpRequest req,
        Guid groupId, Guid targetUserId)
    {
        var actingUserId = await req.GetCallerUserIdAsync(db);
        if (!actingUserId.HasValue || actingUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        if (actingUserId.Value == targetUserId)
        {
            return new BadRequestObjectResult("Use the leave-group action to remove yourself.");
        }

        var actorRole = await db.GetRoleAsync(groupId, actingUserId.Value);
        if (actorRole is not (GroupRole.Administrator or GroupRole.Owner))
        {
            return Forbidden("Only group administrators can remove members.");
        }

        var target = await db.GroupMemberships.SingleOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == targetUserId);
        if (target is null)
        {
            return new NotFoundObjectResult("User is not a member of this group.");
        }

        if (target.Status == GroupMembershipStatus.Pending)
        {
            return new BadRequestObjectResult("Use the approve/reject actions for a pending join request.");
        }

        var allowed = actorRole == GroupRole.Owner
            ? target.Role != GroupRole.Owner
            : target.Role == GroupRole.Member;

        if (!allowed)
        {
            return Forbidden("You do not have permission to remove this member.");
        }

        db.GroupMemberships.Remove(target);
        await db.SaveChangesAsync();

        return new OkResult();
    }

    /// <summary>POST /api/groups/{groupId}/members/{targetUserId}/promote — owner grants administrator access.</summary>
    [Function("GrantGroupAdministrator")]
    public async Task<IActionResult> GrantGroupAdministrator(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/members/{targetUserId:guid}/promote")] HttpRequest req,
        Guid groupId, Guid targetUserId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole != GroupRole.Owner)
        {
            return Forbidden("Only the group owner can assign administrators.");
        }

        var target = await db.GroupMemberships.SingleOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == targetUserId);
        if (target is null)
        {
            return new NotFoundObjectResult("User is not a member of this group.");
        }

        if (target.Role == GroupRole.Owner)
        {
            return new BadRequestObjectResult("The group owner already has full access.");
        }

        target.Role = GroupRole.Administrator;
        await db.SaveChangesAsync();

        return new OkResult();
    }

    /// <summary>POST /api/groups/{groupId}/members/{targetUserId}/demote — owner revokes administrator access.</summary>
    [Function("RevokeGroupAdministrator")]
    public async Task<IActionResult> RevokeGroupAdministrator(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/members/{targetUserId:guid}/demote")] HttpRequest req,
        Guid groupId, Guid targetUserId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole != GroupRole.Owner)
        {
            return Forbidden("Only the group owner can revoke administrator access.");
        }

        var target = await db.GroupMemberships.SingleOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == targetUserId);
        if (target is null)
        {
            return new NotFoundObjectResult("User is not a member of this group.");
        }

        if (target.Role != GroupRole.Administrator)
        {
            return new BadRequestObjectResult("User is not an administrator.");
        }

        target.Role = GroupRole.Member;
        await db.SaveChangesAsync();

        return new OkResult();
    }

    /// <summary>
    /// POST /api/groups/{groupId}/transfer-ownership — hand over group ownership.
    /// The current owner becomes an administrator; the target must already be a member.
    /// </summary>
    [Function("TransferGroupOwnership")]
    public async Task<IActionResult> TransferGroupOwnership(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/transfer-ownership")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<TransferOwnershipRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("NewOwnerUserId is required.");
        }

        if (callerUserId.Value == body.NewOwnerUserId)
        {
            return new BadRequestObjectResult("You are already the group owner.");
        }

        var currentOwner = await db.GroupMemberships.SingleOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == callerUserId.Value);
        if (currentOwner is null || currentOwner.Role != GroupRole.Owner)
        {
            return Forbidden("Only the group owner can transfer ownership.");
        }

        var newOwner = await db.GroupMemberships.SingleOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == body.NewOwnerUserId);
        if (newOwner is null)
        {
            return new BadRequestObjectResult("The new owner must already be a member of the group.");
        }

        currentOwner.Role = GroupRole.Administrator;
        newOwner.Role = GroupRole.Owner;
        await db.SaveChangesAsync();

        return new OkResult();
    }

    /// <summary>PATCH /api/groups/{groupId}/privacy — admins toggle whether the group is private.</summary>
    [Function("UpdateGroupPrivacy")]
    public async Task<IActionResult> UpdateGroupPrivacy(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "groups/{groupId:guid}/privacy")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<UpdateGroupPrivacyRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request payload is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (!actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators can change privacy settings.");
        }

        var group = await db.Groups.FindAsync(groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        group.IsPrivate = body.IsPrivate;
        await db.SaveChangesAsync();

        return new OkResult();
    }

    /// <summary>POST /api/groups/{groupId}/invite-code — admins regenerate the group's invite code.</summary>
    [Function("RegenerateGroupInviteCode")]
    public async Task<IActionResult> RegenerateGroupInviteCode(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/invite-code")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (!actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators can regenerate the invite code.");
        }

        var group = await db.Groups.FindAsync(groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        group.InviteCode = GenerateInviteCode();
        await db.SaveChangesAsync();

        return new OkObjectResult(new InviteCodeDto(group.InviteCode));
    }

    /// <summary>POST /api/groups/{groupId}/members/{targetUserId}/approve — admins approve a pending join request.</summary>
    [Function("ApproveGroupMember")]
    public async Task<IActionResult> ApproveGroupMember(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/members/{targetUserId:guid}/approve")] HttpRequest req,
        Guid groupId, Guid targetUserId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (!actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators can approve join requests.");
        }

        var target = await db.GroupMemberships.SingleOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == targetUserId);
        if (target is null || target.Status != GroupMembershipStatus.Pending)
        {
            return new NotFoundObjectResult("No pending join request found for this user.");
        }

        target.Status = GroupMembershipStatus.Active;
        target.JoinedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return new OkResult();
    }

    /// <summary>POST /api/groups/{groupId}/members/{targetUserId}/reject — admins reject a pending join request.</summary>
    [Function("RejectGroupMember")]
    public async Task<IActionResult> RejectGroupMember(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/members/{targetUserId:guid}/reject")] HttpRequest req,
        Guid groupId, Guid targetUserId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (!actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators can reject join requests.");
        }

        var target = await db.GroupMemberships.SingleOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == targetUserId);
        if (target is null || target.Status != GroupMembershipStatus.Pending)
        {
            return new NotFoundObjectResult("No pending join request found for this user.");
        }

        db.GroupMemberships.Remove(target);
        await db.SaveChangesAsync();

        return new OkResult();
    }

    /// <summary>POST /api/groups/{groupId}/tunes — add a tune to the group's master tune list.</summary>
    [Function("AddGroupTune")]
    public async Task<IActionResult> AddGroupTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/tunes")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<AddGroupTuneRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("TuneId is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole is not (GroupRole.Administrator or GroupRole.Owner))
        {
            return Forbidden("Only group administrators can edit the master tune list.");
        }

        var tune = await db.Tunes.FindAsync(body.TuneId);
        if (tune is null)
        {
            return new NotFoundObjectResult($"Tune {body.TuneId} not found.");
        }

        if (body.TuneSettingId is not null)
        {
            var settingBelongs = await db.TuneSettings.AnyAsync(s => s.TuneSettingId == body.TuneSettingId && s.TuneId == body.TuneId);
            if (!settingBelongs)
            {
                return new BadRequestObjectResult("TuneSettingId does not belong to the given tune.");
            }
        }

        var alreadyListed = await db.GroupTunes.AnyAsync(gt => gt.GroupId == groupId && gt.TuneId == body.TuneId);
        if (alreadyListed)
        {
            return new ConflictObjectResult("This tune is already on the group's master list.");
        }

        var groupTune = new GroupTune
        {
            GroupId = groupId,
            TuneId = body.TuneId,
            TuneSettingId = body.TuneSettingId,
            AddedByUserId = callerUserId.Value,
        };
        db.GroupTunes.Add(groupTune);
        await db.SaveChangesAsync();

        return new OkObjectResult(await GetGroupTuneAsync(groupTune.GroupTuneId));
    }

    /// <summary>PATCH /api/groups/{groupId}/tunes/{groupTuneId} — change the setting the group uses for a tune.</summary>
    [Function("UpdateGroupTune")]
    public async Task<IActionResult> UpdateGroupTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "groups/{groupId:guid}/tunes/{groupTuneId:guid}")] HttpRequest req,
        Guid groupId, Guid groupTuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<UpdateGroupTuneRequest>();

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole is not (GroupRole.Administrator or GroupRole.Owner))
        {
            return Forbidden("Only group administrators can edit the master tune list.");
        }

        var groupTune = await db.GroupTunes.SingleOrDefaultAsync(gt => gt.GroupTuneId == groupTuneId && gt.GroupId == groupId);
        if (groupTune is null)
        {
            return new NotFoundResult();
        }

        if (body?.TuneSettingId is not null)
        {
            var settingBelongs = await db.TuneSettings.AnyAsync(s => s.TuneSettingId == body.TuneSettingId && s.TuneId == groupTune.TuneId);
            if (!settingBelongs)
            {
                return new BadRequestObjectResult("TuneSettingId does not belong to this tune.");
            }
        }

        groupTune.TuneSettingId = body?.TuneSettingId;
        await db.SaveChangesAsync();

        return new OkObjectResult(await GetGroupTuneAsync(groupTune.GroupTuneId));
    }

    /// <summary>DELETE /api/groups/{groupId}/tunes/{groupTuneId} — remove a tune from the master list.</summary>
    [Function("RemoveGroupTune")]
    public async Task<IActionResult> RemoveGroupTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/tunes/{groupTuneId:guid}")] HttpRequest req,
        Guid groupId, Guid groupTuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole is not (GroupRole.Administrator or GroupRole.Owner))
        {
            return Forbidden("Only group administrators can edit the master tune list.");
        }

        var groupTune = await db.GroupTunes.SingleOrDefaultAsync(gt => gt.GroupTuneId == groupTuneId && gt.GroupId == groupId);
        if (groupTune is null)
        {
            return new NotFoundResult();
        }

        db.GroupTunes.Remove(groupTune);
        await db.SaveChangesAsync();

        return new OkResult();
    }

    private async Task<GroupTuneDto?> GetGroupTuneAsync(Guid groupTuneId) =>
        await db.GroupTunes
            .AsNoTracking()
            .Where(gt => gt.GroupTuneId == groupTuneId)
            .Select(gt => new GroupTuneDto(
                gt.GroupTuneId,
                gt.TuneId,
                gt.Tune.Title,
                gt.Tune.TuneType.ToString(),
                gt.TuneSetting != null ? gt.TuneSetting.Key : gt.Tune.Key,
                gt.TuneSettingId,
                gt.TuneSetting != null ? gt.TuneSetting.SubmitterName : null,
                gt.AddedByUser.DisplayName))
            .SingleOrDefaultAsync();

    /// <summary>DELETE /api/groups/{groupId} — owners delete the group.</summary>
    [Function("DeleteGroup")]
    public async Task<IActionResult> DeleteGroup(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (actorRole != GroupRole.Owner)
        {
            return Forbidden("Only the group owner can delete this group.");
        }

        var group = await db.Groups.FindAsync(groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        db.Groups.Remove(group);
        await db.SaveChangesAsync();

        return new OkResult();
    }
}
