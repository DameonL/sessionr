using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions.GroupSets.ByGroupSetId;

public class Get(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>GET /api/groupsets/{groupSetId}?userId= — a single group set with analysis.</summary>
    [Function("GetGroupSet")]
    public async Task<IActionResult> GetGroupSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groupsets/{groupSetId:guid}")] HttpRequest req,
        Guid groupSetId)
    {
        var userId = Guid.Empty;
        return await GroupSetSupport.LoadedSetResultAsync(db, analyzer, groupSetId, userId);
    }
}
