using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Tunes.ByTuneId.Votes;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/tunes/{tuneId}/my-votes — fetch the caller's personal setting votes for a tune (requires sign-in).</summary>
    [Function("GetMyTuneVotes")]
    public async Task<IActionResult> GetMyTuneVotes(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "tunes/{tuneId:guid}/my-votes")] HttpRequest req,
        Guid tuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }
        var userId = callerUserId.Value;

        var settingIds = await db.TuneSettings
            .AsNoTracking()
            .Where(s => s.TuneId == tuneId)
            .Select(s => s.TuneSettingId)
            .ToListAsync();

        if (settingIds.Count == 0)
        {
            return new OkObjectResult(new Dictionary<string, int>());
        }

        var myVotes = await db.TuneSettingVotes
            .AsNoTracking()
            .Where(v => v.UserId == userId && settingIds.Contains(v.TuneSettingId))
            .ToDictionaryAsync(v => v.TuneSettingId.ToString(), v => v.Value);

        return new OkObjectResult(myVotes);
    }
}
