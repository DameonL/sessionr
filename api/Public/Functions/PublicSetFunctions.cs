using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions;

/// <summary>Read-only access to a shareable personal set (no ownership check — anyone with the link can view/play it).</summary>
public class PublicSetFunctions(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>GET /api/sets/{setId} — a single set with analysis.</summary>
    [Function("GetSet")]
    public async Task<IActionResult> GetSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sets/{setId:guid}")] HttpRequest req,
        Guid setId)
    {
        return await SetSupport.LoadedSetResultAsync(db, analyzer, setId);
    }
}
