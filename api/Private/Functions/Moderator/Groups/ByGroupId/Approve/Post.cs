using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Groups.ByGroupId.Approve;

[RequireModerator]
public class Post(AppDbContext db)
{
    /// <summary>POST /api/moderator/groups/{groupId}/approve — mark a group as reviewed and approved.</summary>
    [Function("ApproveGroup")]
    public async Task<IActionResult> ApproveGroup(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "moderator/groups/{groupId:guid}/approve")] HttpRequest req,
        Guid groupId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var group = await db.Groups.SingleOrDefaultAsync(g => g.GroupId == groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        var caller = req.GetCallerIdentity();
        group.IsReviewed = true;
        group.ReviewedAt = DateTime.UtcNow;
        group.ReviewedBy = caller.Email ?? caller.DisplayName ?? caller.UserId?.ToString() ?? "Moderator";

        await db.SaveChangesAsync();

        // Memberships are separate documents; count them directly rather than via an Include.
        var memberCount = await db.GroupMemberships.CountAsync(m => m.GroupId == groupId);
        return new OkObjectResult(new UnreviewedGroups.Get.ModeratorGroupDto(group.GroupId, group.Name, group.Description, group.City, group.IsPrivate, group.InviteCode, group.IsReviewed, group.ReviewedAt, group.ReviewedBy, group.CreatedAt, memberCount));
    }
}
