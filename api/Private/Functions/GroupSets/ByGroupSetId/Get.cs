using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using SessionApp.Api.Data;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.GroupSets.ByGroupSetId;

public class Get(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>GET /api/groupsets/{groupSetId} — a single group set with analysis (requires sign-in).</summary>
    [Function("GetGroupSet")]
    public async Task<IActionResult> GetGroupSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groupsets/{groupSetId:guid}")] HttpRequest req,
        Guid groupSetId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }
        return await GroupSetSupport.LoadedSetResultAsync(db, analyzer, groupSetId, callerUserId.Value);
    }
}
