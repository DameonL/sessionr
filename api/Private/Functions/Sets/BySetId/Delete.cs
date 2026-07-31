using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Sets.BySetId;

public class Delete(AppDbContext db)
{
    /// <summary>DELETE /api/sets/{setId}</summary>
    [Function("DeleteSet")]
    public async Task<IActionResult> DeleteSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "sets/{setId:guid}")] HttpRequest req,
        Guid setId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var set = await db.Sets.SingleOrDefaultAsync(s => s.SetId == setId && s.UserId == callerUserId.Value);
        if (set is null)
        {
            return new NotFoundResult();
        }

        db.Sets.Remove(set);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }
}
