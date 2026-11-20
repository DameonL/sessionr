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
    /// <summary>GET /api/moderator/groups — fetch paged groups (public and private).</summary>
    [Function("GetModeratorGroups")]
    public async Task<IActionResult> GetModeratorGroups(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "moderator/groups")] HttpRequest req)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        int.TryParse(req.Query["page"], out var page);
        if (page < 1) page = 1;

        int.TryParse(req.Query["pageSize"], out var pageSize);
        if (pageSize < 1) pageSize = 50;
        if (pageSize > 100) pageSize = 100;

        var totalCount = await db.Groups.AsNoTracking().Select(g => g.GroupId).CosmosCountAsync();

        var groupEntities = await db.Groups
            .AsNoTracking()
            .OrderByDescending(g => g.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
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

        var hasMore = (page * pageSize) < totalCount;
        return new OkObjectResult(new PagedResult<UnreviewedGroups.Get.ModeratorGroupDto>(groups, totalCount, page, pageSize, hasMore));
    }
}
