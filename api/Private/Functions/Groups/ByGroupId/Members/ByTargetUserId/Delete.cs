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

namespace SessionApp.Api.Functions.Groups.ByGroupId.Members.ByTargetUserId;

public class Delete(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
    /// <summary>DELETE /api/groups/{groupId}/members/{targetUserId} — remove a member from the group.</summary>
    [Function("RemoveMember")]
    public async Task<IActionResult> RemoveMember(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/members/{targetUserId:guid}")] HttpRequest req,
        Guid groupId,
        Guid targetUserId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var targetMembership = await db.GroupMemberships
            .FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == targetUserId);
        if (targetMembership is null)
        {
            return new NotFoundResult();
        }

        if (targetMembership.Role == GroupRole.Owner)
        {
            return new BadRequestObjectResult("Cannot remove the group Owner.");
        }

        db.GroupMemberships.Remove(targetMembership);
        await db.SaveChangesAsync();
        await purgeService.PurgeGroupAsync(groupId);
        return new NoContentResult();
    }
}
