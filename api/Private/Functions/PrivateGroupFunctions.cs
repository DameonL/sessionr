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
        var body = await req.ReadFromJsonAsync<CreateGroupRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Name))
        {
            return new BadRequestObjectResult("Group name is required.");
        }

        var user = await db.Users.FindAsync(body.UserId);
        if (user is null)
        {
            return new NotFoundObjectResult($"User {body.UserId} not found.");
        }

        var group = new Group
        {
            Name = body.Name.Trim(),
            IsPrivate = body.IsPrivate,
            InviteCode = GenerateInviteCode(),
        };
        db.Groups.Add(group);
        db.GroupMemberships.Add(new GroupMembership
        {
            Group = group,
            User = user,
            Role = GroupRole.Owner
        });

        await db.SaveChangesAsync();

        return new OkObjectResult(new GroupDto(group.GroupId, group.Name, 1, true, group.IsPrivate, false));
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
        var body = await req.ReadFromJsonAsync<JoinGroupRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId is required.");
        }

        var group = await db.Groups.FindAsync(groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        var user = await db.Users.FindAsync(body.UserId);
        if (user is null)
        {
            return new NotFoundObjectResult($"User {body.UserId} not found.");
        }

        var existing = await db.GroupMemberships.SingleOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == body.UserId);
        if (existing is not null)
        {
            return new ConflictObjectResult(existing.Status == GroupMembershipStatus.Pending
                ? "Your request to join is already pending approval."
                : "User is already a member of this group.");
        }

        var codeValid = group.IsPrivate
            && !string.IsNullOrWhiteSpace(body.InviteCode)
            && string.Equals(body.InviteCode.Trim(), group.InviteCode, StringComparison.OrdinalIgnoreCase);

        var status = !group.IsPrivate || codeValid ? GroupMembershipStatus.Active : GroupMembershipStatus.Pending;

        db.GroupMemberships.Add(new GroupMembership
        {
            GroupId = groupId,
            UserId = body.UserId,
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
        var body = await req.ReadFromJsonAsync<GroupJoinLeaveRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId is required.");
        }

        var group = await db.Groups.Include(g => g.Memberships).SingleOrDefaultAsync(g => g.GroupId == groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        var membership = group.Memberships.FirstOrDefault(m => m.UserId == body.UserId);
        if (membership is null)
        {
            return new NotFoundObjectResult("User is not a member of this group.");
        }

        var otherActiveMembers = group.Memberships.Count(m => m.Status == GroupMembershipStatus.Active && m.UserId != body.UserId);

        if (membership.Role == GroupRole.Owner && membership.Status == GroupMembershipStatus.Active && otherActiveMembers > 0)
        {
            return new BadRequestObjectResult("Transfer group ownership to another member before leaving.");
        }

        db.GroupMemberships.Remove(membership);

        // If no active members remain, clean up the group (cascades memberships/pending requests/tunes).
        if (otherActiveMembers == 0)
        {
            db.Groups.Remove(group);
        }

        await db.SaveChangesAsync();

        return new OkResult();
    }

    /// <summary>
    /// DELETE /api/groups/{groupId}/members/{targetUserId}?userId={actingUserId} — remove a member.
    /// Administrators may remove regular members; only the owner may remove administrators.
    /// Nobody can remove the owner or themselves this way (use transfer-ownership / leave instead).
    /// </summary>
    [Function("RemoveGroupMember")]
    public async Task<IActionResult> RemoveGroupMember(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/members/{targetUserId:guid}")] HttpRequest req,
        Guid groupId, Guid targetUserId)
    {
        Guid.TryParse(req.Query["userId"], out var actingUserId);

        if (actingUserId == targetUserId)
        {
            return new BadRequestObjectResult("Use the leave-group action to remove yourself.");
        }

        var actorRole = await db.GetRoleAsync(groupId, actingUserId);
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
        var body = await req.ReadFromJsonAsync<GroupRoleActionRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, body.UserId);
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
        var body = await req.ReadFromJsonAsync<GroupRoleActionRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, body.UserId);
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
        var body = await req.ReadFromJsonAsync<TransferOwnershipRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId and NewOwnerUserId are required.");
        }

        if (body.UserId == body.NewOwnerUserId)
        {
            return new BadRequestObjectResult("You are already the group owner.");
        }

        var currentOwner = await db.GroupMemberships.SingleOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == body.UserId);
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
        var body = await req.ReadFromJsonAsync<UpdateGroupPrivacyRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, body.UserId);
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
        var body = await req.ReadFromJsonAsync<GroupRoleActionRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, body.UserId);
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
        var body = await req.ReadFromJsonAsync<GroupRoleActionRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, body.UserId);
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
        var body = await req.ReadFromJsonAsync<GroupRoleActionRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, body.UserId);
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
        var body = await req.ReadFromJsonAsync<AddGroupTuneRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId and TuneId are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, body.UserId);
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
            AddedByUserId = body.UserId,
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
        var body = await req.ReadFromJsonAsync<UpdateGroupTuneRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, body.UserId);
        if (actorRole is not (GroupRole.Administrator or GroupRole.Owner))
        {
            return Forbidden("Only group administrators can edit the master tune list.");
        }

        var groupTune = await db.GroupTunes.SingleOrDefaultAsync(gt => gt.GroupTuneId == groupTuneId && gt.GroupId == groupId);
        if (groupTune is null)
        {
            return new NotFoundResult();
        }

        if (body.TuneSettingId is not null)
        {
            var settingBelongs = await db.TuneSettings.AnyAsync(s => s.TuneSettingId == body.TuneSettingId && s.TuneId == groupTune.TuneId);
            if (!settingBelongs)
            {
                return new BadRequestObjectResult("TuneSettingId does not belong to this tune.");
            }
        }

        groupTune.TuneSettingId = body.TuneSettingId;
        await db.SaveChangesAsync();

        return new OkObjectResult(await GetGroupTuneAsync(groupTune.GroupTuneId));
    }

    /// <summary>DELETE /api/groups/{groupId}/tunes/{groupTuneId}?userId= — remove a tune from the master list.</summary>
    [Function("RemoveGroupTune")]
    public async Task<IActionResult> RemoveGroupTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/tunes/{groupTuneId:guid}")] HttpRequest req,
        Guid groupId, Guid groupTuneId)
    {
        Guid.TryParse(req.Query["userId"], out var userId);

        var actorRole = await db.GetRoleAsync(groupId, userId);
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
        var body = await req.ReadFromJsonAsync<GroupJoinLeaveRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, body.UserId);
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
