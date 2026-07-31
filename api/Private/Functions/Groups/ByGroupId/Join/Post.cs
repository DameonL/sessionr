using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Join;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/groups/{groupId}/join — join a public group or request to join a private group.</summary>
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

        var group = await db.Groups.SingleOrDefaultAsync(g => g.GroupId == groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        var existing = await db.GroupMemberships
            .FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == callerUserId.Value);

        if (existing is not null)
        {
            if (existing.Status == GroupMembershipStatus.Active)
            {
                return new ConflictObjectResult("You are already a member of this group.");
            }
            if (existing.Status == GroupMembershipStatus.Pending)
            {
                return new ConflictObjectResult("Your join request is pending approval.");
            }
        }

        var body = await req.ReadFromJsonAsync<JoinGroupRequest>();

        if (group.IsPrivate)
        {
            var codeProvided = body?.InviteCode?.Trim().ToUpperInvariant();
            var matchesCode = !string.IsNullOrEmpty(group.InviteCode) &&
                string.Equals(codeProvided, group.InviteCode, StringComparison.OrdinalIgnoreCase);

            var initialStatus = matchesCode ? GroupMembershipStatus.Active : GroupMembershipStatus.Pending;

            if (existing is not null)
            {
                existing.Status = initialStatus;
                existing.JoinedAt = DateTime.UtcNow;
            }
            else
            {
                db.GroupMemberships.Add(new GroupMembership
                {
                    GroupId = groupId,
                    UserId = callerUserId.Value,
                    Role = GroupRole.Member,
                    Status = initialStatus,
                    JoinedAt = DateTime.UtcNow
                });
            }

            if (initialStatus == GroupMembershipStatus.Active)
            {
                db.GroupFeedEvents.Add(new GroupFeedEvent
                {
                    GroupId = groupId,
                    UserId = callerUserId.Value,
                    EventType = GroupFeedEventType.MemberJoined,
                    Payload = "{}",
                });
            }

            await db.SaveChangesAsync();

            return initialStatus == GroupMembershipStatus.Active
                ? new OkObjectResult(new { Status = "Active", Message = "Joined group successfully via invite code." })
                : new OkObjectResult(new { Status = "Pending", Message = "Join request submitted. Pending administrator approval." });
        }
        else
        {
            if (existing is not null)
            {
                existing.Status = GroupMembershipStatus.Active;
                existing.JoinedAt = DateTime.UtcNow;
            }
            else
            {
                db.GroupMemberships.Add(new GroupMembership
                {
                    GroupId = groupId,
                    UserId = callerUserId.Value,
                    Role = GroupRole.Member,
                    Status = GroupMembershipStatus.Active,
                    JoinedAt = DateTime.UtcNow
                });
            }

            db.GroupFeedEvents.Add(new GroupFeedEvent
            {
                GroupId = groupId,
                UserId = callerUserId.Value,
                EventType = GroupFeedEventType.MemberJoined,
                Payload = "{}",
            });

            await db.SaveChangesAsync();
            return new OkObjectResult(new { Status = "Active", Message = "Joined group successfully." });
        }
    }
}
