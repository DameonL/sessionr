using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Sets;

public class Get(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>GET /api/groups/{groupId}/sets — the group's set lists with analysis (requires sign-in).</summary>
    [Function("GetGroupSets")]
    public async Task<IActionResult> GetGroupSets(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groups/{groupId:guid}/sets")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }
        var userId = callerUserId.Value;

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
