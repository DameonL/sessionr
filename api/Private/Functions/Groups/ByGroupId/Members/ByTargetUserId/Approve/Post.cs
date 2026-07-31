using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Members.ByTargetUserId.Approve;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/groups/{groupId}/members/{targetUserId}/approve — approve a pending join request.</summary>
    [Function("ApproveGroupJoinRequest")]
    public async Task<IActionResult> ApproveGroupJoinRequest(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/members/{targetUserId:guid}/approve")] HttpRequest req,
        Guid groupId,
        Guid targetUserId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var membership = await db.GroupMemberships
            .FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == targetUserId && m.Status == GroupMembershipStatus.Pending);

        if (membership is null)
        {
            return new NotFoundObjectResult("Pending join request not found.");
        }

        membership.Status = GroupMembershipStatus.Active;
        membership.JoinedAt = DateTime.UtcNow;

        db.GroupFeedEvents.Add(new GroupFeedEvent
        {
            GroupId = groupId,
            UserId = targetUserId,
            EventType = GroupFeedEventType.MemberJoined,
            Payload = "{}",
        });

        await db.SaveChangesAsync();
        return new OkObjectResult(new { Message = "Join request approved." });
    }
}
