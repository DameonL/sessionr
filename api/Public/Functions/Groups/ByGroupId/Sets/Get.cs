using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Sets;

public class Get(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>GET /api/groups/{groupId}/sets?userId= — the group's set lists with analysis.</summary>
    [Function("GetGroupSets")]
    public async Task<IActionResult> GetGroupSets(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groups/{groupId:guid}/sets")] HttpRequest req,
        Guid groupId)
    {
        var userId = Guid.Empty;

        var viewError = await GroupSetSupport.EnsureCanViewAsync(db, groupId, userId);
        if (viewError is not null)
        {
            return viewError;
        }

        var rawGroupSets = await db.GroupSets
            .AsNoTracking()
            .Where(gs => gs.GroupId == groupId)
            .OrderBy(gs => gs.Title)
            .ToListAsync();

        await GroupSetSupport.PopulateItemsAsync(db, rawGroupSets.ToArray());

        var sets = rawGroupSets
            .Select(s => GroupSetSupport.ToSummaryDto(
                s.GroupSetId,
                s.GroupId,
                s.Title,
                s.Items.Select(i => (
                    i.GroupTuneId,
                    i.SequenceNumber,
                    i.Repetitions,
                    i.GroupTune.Tune.Title,
                    i.GroupTune.Tune.TuneType,
                    GroupSetSupport.EffectiveKey(i.GroupTune))).ToList(),
                analyzer))
            .ToList();

        return new OkObjectResult(sets);
    }
}
