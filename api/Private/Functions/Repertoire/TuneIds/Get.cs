using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Repertoire.TuneIds;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/repertoire/tune-ids — lightweight list of TuneIds in the caller's repertoire.</summary>
    [Function("GetRepertoireTuneIds")]
    public async Task<IActionResult> GetRepertoireTuneIds(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "repertoire/tune-ids")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var tuneIds = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == callerUserId.Value)
            .Select(ut => ut.TuneId)
            .Distinct()
            .ToListAsync();

        return new OkObjectResult(tuneIds);
    }
}
