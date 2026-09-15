using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Leave;

public class Post(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
    /// <summary>POST /api/groups/{groupId}/leave — leave a group. The Owner cannot leave; they must transfer ownership or delete the group.</summary>
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

        var membership = await db.GroupMemberships
            .FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == callerUserId.Value && m.Status == GroupMembershipStatus.Active);

        if (membership is null)
        {
            return new BadRequestObjectResult("You are not an active member of this group.");
        }

        if (membership.Role == GroupRole.Owner)
        {
            return new BadRequestObjectResult("As the Owner, you must transfer ownership to another member or delete the group — you cannot leave it directly.");
        }

        db.GroupMemberships.Remove(membership);
        await db.SaveChangesAsync();
        await purgeService.PurgeGroupAsync(groupId);

        return new OkObjectResult(new { Message = "Left group successfully." });
    }
}
