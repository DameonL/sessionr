using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions.Sets.BySetId;

public class Get(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>
    /// GET /api/sets/{setId} — a single set with analysis.
    ///
    /// A set outlives its profile link, so the owner's privacy is checked here too: without it every
    /// set of a private profile would stay readable by direct URL, which is exactly the link a user
    /// going private expects to break. The check lives here rather than in
    /// <see cref="SetSupport.LoadedSetResultAsync"/> because the Private app uses that same helper to
    /// echo a set back to its own owner after a write.
    /// </summary>
    [Function("GetSet")]
    public async Task<IActionResult> GetSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sets/{setId:guid}")] HttpRequest req,
        Guid setId)
    {
        var set = await db.Sets.AsNoTracking().SingleOrDefaultAsync(s => s.SetId == setId);
        if (set is null)
        {
            return new NotFoundResult();
        }

        if (!await ProfileVisibility.IsPubliclyVisibleAsync(db, set.UserId))
        {
            return new NotFoundResult();
        }

        return await SetSupport.LoadedSetResultAsync(db, analyzer, setId);
    }
}
