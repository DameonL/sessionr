using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.TransferOwnership;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/groups/{groupId}/transfer-ownership — transfer ownership of the group to another active member.</summary>
    [Function("TransferGroupOwnership")]
    public async Task<IActionResult> TransferGroupOwnership(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/transfer-ownership")] HttpRequest req,
        Guid groupId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner);
        if (authResult is not null)
        {
            return authResult;
        }

        var callerUserId = await req.GetCallerUserIdAsync(db);
        var body = await req.ReadFromJsonAsync<TransferOwnershipRequest>();
        if (body is null || body.NewOwnerUserId == Guid.Empty)
        {
            return new BadRequestObjectResult("NewOwnerUserId is required.");
        }

        if (body.NewOwnerUserId == callerUserId!.Value)
        {
            return new BadRequestObjectResult("You are already the owner.");
        }

        var targetMembership = await db.GroupMemberships
            .FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == body.NewOwnerUserId && m.Status == GroupMembershipStatus.Active);
        if (targetMembership is null)
        {
            return new BadRequestObjectResult("Target user is not an active member of this group.");
        }

        var currentOwnerMembership = await db.GroupMemberships
            .SingleAsync(m => m.GroupId == groupId && m.UserId == callerUserId.Value);

        currentOwnerMembership.Role = GroupRole.Administrator;
        targetMembership.Role = GroupRole.Owner;

        await db.SaveChangesAsync();
        return new OkObjectResult(new { Message = "Ownership transferred successfully." });
    }
}
