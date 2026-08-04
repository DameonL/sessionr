using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions.Groups;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/groups?userId={userId} — list all groups with user membership status.</summary>
    [Function("GetGroups")]
    public async Task<IActionResult> GetGroups(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groups")] HttpRequest req)
    {
        var userId = Guid.Empty;
        var search = req.Query["search"].ToString();

        int.TryParse(req.Query["page"], out var page);
        if (page < 1) page = 1;

        int.TryParse(req.Query["pageSize"], out var pageSize);
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 100) pageSize = 100;

        var callerGroupIds = await db.GroupMemberships
            .AsNoTracking()
            .Where(m => m.UserId == userId)
            .Select(m => m.GroupId)
            .Distinct()
            .ToListAsync();

        var query = db.Groups
            .AsNoTracking()
            .Where(g => !g.IsPrivate || callerGroupIds.Contains(g.GroupId));

        if (!string.IsNullOrWhiteSpace(search))
        {
            var searchLower = search.Trim().ToLower();
            query = query.Where(g => g.Name.ToLower().Contains(searchLower) || (g.City != null && g.City.ToLower().Contains(searchLower)));
        }

        var totalCount = await query.CountAsync();

        var pagedGroups = await query
            .OrderBy(g => g.Name)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var pagedGroupIds = pagedGroups.Select(g => g.GroupId).ToList();
        var memberships = pagedGroupIds.Count == 0
            ? new System.Collections.Generic.List<GroupMembership>()
            : await db.GroupMemberships
                .AsNoTracking()
                .Where(m => pagedGroupIds.Contains(m.GroupId))
                .ToListAsync();

        var membershipsByGroup = memberships.ToLookup(m => m.GroupId);

        var groups = pagedGroups.Select(g =>
        {
            var groupMemberships = membershipsByGroup[g.GroupId].ToList();
            var isMember = groupMemberships.Any(m => m.UserId == userId && m.Status == GroupMembershipStatus.Active);
            var isPending = groupMemberships.Any(m => m.UserId == userId && m.Status == GroupMembershipStatus.Pending);
            var activeCount = groupMemberships.Count(m => m.Status == GroupMembershipStatus.Active);
            var description = g.IsPrivate && !isMember ? null : g.Description;

            return new GroupDto(
                g.GroupId,
                g.Name,
                description,
                g.City,
                activeCount,
                isMember,
                g.IsPrivate,
                isPending);
        }).ToList();

        var hasMore = (page * pageSize) < totalCount;
        return new OkObjectResult(new PagedResult<GroupDto>(groups, totalCount, page, pageSize, hasMore));
    }
}
