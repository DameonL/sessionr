using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.GroupSets.ByGroupSetId;

public class Delete(AppDbContext db)
{
    /// <summary>DELETE /api/groupsets/{groupSetId} — admin/owner only.</summary>
    [Function("DeleteGroupSet")]
    public async Task<IActionResult> DeleteGroupSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groupsets/{groupSetId:guid}")] HttpRequest req,
        Guid groupSetId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var groupSet = await db.GroupSets.FindAsync(groupSetId);
        if (groupSet is null)
        {
            return new NotFoundResult();
        }

        var actorRole = await db.GetRoleAsync(groupSet.GroupId, callerUserId.Value);
        if (!req.IsCallerModerator() && !actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators or moderators can delete set lists.");
        }

        db.GroupSets.Remove(groupSet);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }
}
