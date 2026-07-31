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

        var query = db.Groups
            .AsNoTracking()
            .Where(g => !g.IsPrivate || g.Memberships.Any(m => m.UserId == userId));

        if (!string.IsNullOrWhiteSpace(search))
        {
            query = query.Where(g => EF.Functions.Like(g.Name, $"%{search}%") || (g.City != null && EF.Functions.Like(g.City, $"%{search}%")));
        }

        var totalCount = await query.CountAsync();

        var groups = await query
            .OrderBy(g => g.Name)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(g => new GroupDto(
                g.GroupId,
                g.Name,
                g.IsPrivate && !g.Memberships.Any(m => m.UserId == userId && m.Status == GroupMembershipStatus.Active) ? null : g.Description,
                g.City,
                g.Memberships.Count(m => m.Status == GroupMembershipStatus.Active),
                g.Memberships.Any(m => m.UserId == userId && m.Status == GroupMembershipStatus.Active),
                g.IsPrivate,
                g.Memberships.Any(m => m.UserId == userId && m.Status == GroupMembershipStatus.Pending)))
            .ToListAsync();

        var hasMore = (page * pageSize) < totalCount;
        return new OkObjectResult(new PagedResult<GroupDto>(groups, totalCount, page, pageSize, hasMore));
    }
}
