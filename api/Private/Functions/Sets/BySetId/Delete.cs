using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Sets.BySetId;

public class Delete(AppDbContext db, ICloudflareCachePurgeService purgeService)
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

        // No cascade delete in Cosmos — the set's items are separate documents, and were being left
        // behind pointing at a set that no longer exists.
        var items = await db.SetItems.Where(si => si.SetId == setId).ToListAsync();
        db.SetItems.RemoveRange(items);
        db.Sets.Remove(set);
        await db.SaveChangesAsync();

        await purgeService.PurgeSetAsync(setId);
        return new NoContentResult();
    }
}
