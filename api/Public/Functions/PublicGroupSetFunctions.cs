using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions;

/// <summary>Read-only access to a group's set lists (mirrors the personal Set feature, sourced from the master tune list).</summary>
public class PublicGroupSetFunctions(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>GET /api/groups/{groupId}/sets?userId= — the group's set lists with analysis.</summary>
    [Function("GetGroupSets")]
    public async Task<IActionResult> GetGroupSets(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groups/{groupId:guid}/sets")] HttpRequest req,
        Guid groupId)
    {
        Guid.TryParse(req.Query["userId"], out var userId);

        var viewError = await GroupSetSupport.EnsureCanViewAsync(db, groupId, userId);
        if (viewError is not null)
        {
            return viewError;
        }

        var sets = await db.GroupSets
            .AsNoTracking()
            .Where(gs => gs.GroupId == groupId)
            .Include(gs => gs.Items.OrderBy(i => i.SequenceNumber))
            .ThenInclude(i => i.GroupTune).ThenInclude(gt => gt.Tune)
            .Include(gs => gs.Items)
            .ThenInclude(i => i.GroupTune).ThenInclude(gt => gt.TuneSetting)
            .OrderBy(gs => gs.Title)
            .ToListAsync();

        return new OkObjectResult(sets.Select(s => GroupSetSupport.ToDto(s, analyzer)).ToList());
    }

    /// <summary>GET /api/groupsets/{groupSetId}?userId= — a single group set with analysis.</summary>
    [Function("GetGroupSet")]
    public async Task<IActionResult> GetGroupSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groupsets/{groupSetId:guid}")] HttpRequest req,
        Guid groupSetId)
    {
        Guid.TryParse(req.Query["userId"], out var userId);
        return await GroupSetSupport.LoadedSetResultAsync(db, analyzer, groupSetId, userId);
    }
}
