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

namespace SessionApp.Api.Functions.Sets;

public class Get(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>GET /api/sets — the user's sets with analysis.</summary>
    [Function("GetSets")]
    public async Task<IActionResult> GetSets(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sets")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var rawSets = await db.Sets
            .AsNoTracking()
            .Where(s => s.UserId == callerUserId.Value)
            .OrderBy(s => s.Title)
            .ToListAsync();

        await SetSupport.PopulateItemsAsync(db, rawSets.ToArray());

        var sets = rawSets
            .Select(s => SetSupport.ToSummaryDto(
                s.SetId,
                s.Title,
                s.Items.Select(i => (
                    i.UserTuneId,
                    i.SequenceNumber,
                    i.Repetitions,
                    i.UserTune.Tune.Title,
                    i.UserTune.Tune.TuneType,
                    i.UserTune.TuneSetting != null ? i.UserTune.TuneSetting.Key : i.UserTune.Tune.Key)).ToList(),
                analyzer))
            .ToList();

        return new OkObjectResult(sets);
    }
}
