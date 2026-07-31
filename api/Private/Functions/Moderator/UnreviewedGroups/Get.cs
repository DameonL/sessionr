using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.UnreviewedGroups;

[RequireModerator]
public class Get(AppDbContext db)
{
    public record ModeratorGroupDto(Guid GroupId, string Name, string Description, string? City, bool IsPrivate, string? InviteCode, bool IsReviewed, DateTime? ReviewedAt, string? ReviewedBy, DateTime CreatedAt, int MemberCount);

    /// <summary>GET /api/moderator/unreviewed-groups — fetch all groups pending moderator review.</summary>
    [Function("GetUnreviewedGroups")]
    public async Task<IActionResult> GetUnreviewedGroups(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "moderator/unreviewed-groups")] HttpRequest req)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var groups = await db.Groups
            .AsNoTracking()
            .Where(g => !g.IsReviewed)
            .OrderByDescending(g => g.CreatedAt)
            .Select(g => new ModeratorGroupDto(g.GroupId, g.Name, g.Description, g.City, g.IsPrivate, g.InviteCode, g.IsReviewed, g.ReviewedAt, g.ReviewedBy, g.CreatedAt, g.Memberships.Count))
            .ToListAsync();

        return new OkObjectResult(groups);
    }
}
