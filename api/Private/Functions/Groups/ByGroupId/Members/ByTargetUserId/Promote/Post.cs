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

namespace SessionApp.Api.Functions.Groups.ByGroupId.Members.ByTargetUserId.Promote;

public class Post(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
    /// <summary>POST /api/groups/{groupId}/members/{targetUserId}/promote — promote a Member to Administrator.</summary>
    [Function("PromoteMember")]
    public async Task<IActionResult> PromoteMember(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/members/{targetUserId:guid}/promote")] HttpRequest req,
        Guid groupId,
        Guid targetUserId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner);
        if (authResult is not null)
        {
            return authResult;
        }

        var targetMembership = await db.GroupMemberships
            .FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == targetUserId && m.Status == GroupMembershipStatus.Active);
        if (targetMembership is null)
        {
            return new NotFoundResult();
        }

        targetMembership.Role = GroupRole.Administrator;
        await db.SaveChangesAsync();
        await purgeService.PurgeGroupAsync(groupId);
        return new OkObjectResult(new { Message = "Member promoted to Administrator." });
    }
}
