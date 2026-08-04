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

namespace SessionApp.Api.Functions.Moderator.Groups;

[RequireModerator]
public class Get(AppDbContext db)
{
    /// <summary>GET /api/moderator/groups — fetch all groups (public and private).</summary>
    [Function("GetModeratorGroups")]
    public async Task<IActionResult> GetModeratorGroups(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "moderator/groups")] HttpRequest req)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var groupEntities = await db.Groups
            .AsNoTracking()
            .OrderByDescending(g => g.CreatedAt)
            .ToListAsync();

        var groupIds = groupEntities.Select(g => g.GroupId).ToList();
        var memberships = groupIds.Count == 0
            ? new System.Collections.Generic.List<Models.GroupMembership>()
            : await db.GroupMemberships
                .AsNoTracking()
                .Where(m => groupIds.Contains(m.GroupId))
                .ToListAsync();

        var memberCountsByGroup = memberships
            .GroupBy(m => m.GroupId)
            .ToDictionary(g => g.Key, g => g.Count());

        var groups = groupEntities
            .Select(g => new UnreviewedGroups.Get.ModeratorGroupDto(
                g.GroupId,
                g.Name,
                g.Description,
                g.City,
                g.IsPrivate,
                g.InviteCode,
                g.IsReviewed,
                g.ReviewedAt,
                g.ReviewedBy,
                g.CreatedAt,
                memberCountsByGroup.TryGetValue(g.GroupId, out var c) ? c : 0))
            .ToList();

        return new OkObjectResult(groups);
    }
}
