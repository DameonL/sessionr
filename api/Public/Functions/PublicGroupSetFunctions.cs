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
        // Anonymous, unauthenticated route: never trust a caller-supplied userId. Signed-in
        // callers get the member-aware view from the Private app's GetGroupSets instead.
        var userId = Guid.Empty;

        var viewError = await GroupSetSupport.EnsureCanViewAsync(db, groupId, userId);
        if (viewError is not null)
        {
            return viewError;
        }

        // List view: project only the fields needed for a row + analysis — never reads the
        // (potentially large) ABC columns off disk, unlike the singular GetGroupSet detail view.
        var raw = await db.GroupSets
            .AsNoTracking()
            .Where(gs => gs.GroupId == groupId)
            .OrderBy(gs => gs.Title)
            .Select(gs => new
            {
                gs.GroupSetId,
                gs.GroupId,
                gs.Title,
                Items = gs.Items
                    .OrderBy(i => i.SequenceNumber)
                    .Select(i => new
                    {
                        i.GroupTuneId,
                        i.SequenceNumber,
                        i.Repetitions,
                        i.GroupTune.Tune.Title,
                        i.GroupTune.Tune.TuneType,
                        Key = i.GroupTune.TuneSetting != null ? i.GroupTune.TuneSetting.Key : i.GroupTune.Tune.Key
                    })
                    .ToList()
            })
            .ToListAsync();

        var sets = raw
            .Select(s => GroupSetSupport.ToSummaryDto(
                s.GroupSetId,
                s.GroupId,
                s.Title,
                s.Items.Select(i => (i.GroupTuneId, i.SequenceNumber, i.Repetitions, i.Title, i.TuneType, i.Key)).ToList(),
                analyzer))
            .ToList();

        return new OkObjectResult(sets);
    }

    /// <summary>GET /api/groupsets/{groupSetId}?userId= — a single group set with analysis.</summary>
    [Function("GetGroupSet")]
    public async Task<IActionResult> GetGroupSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groupsets/{groupSetId:guid}")] HttpRequest req,
        Guid groupSetId)
    {
        // Anonymous, unauthenticated route: never trust a caller-supplied userId. Signed-in
        // callers get the member-aware view from the Private app's GetGroupSet instead.
        var userId = Guid.Empty;
        return await GroupSetSupport.LoadedSetResultAsync(db, analyzer, groupSetId, userId);
    }
}
