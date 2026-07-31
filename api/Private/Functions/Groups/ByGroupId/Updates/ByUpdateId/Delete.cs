using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Updates.ByUpdateId;

public class Delete(AppDbContext db)
{
    /// <summary>DELETE /api/groups/{groupId}/updates/{updateId} — delete an update. Admin/Owner only.</summary>
    [Function("DeleteGroupUpdate")]
    public async Task<IActionResult> DeleteGroupUpdate(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/updates/{updateId:guid}")] HttpRequest req,
        Guid groupId,
        Guid updateId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var update = await db.GroupUpdates.SingleOrDefaultAsync(gu => gu.GroupUpdateId == updateId && gu.GroupId == groupId);
        if (update is null)
        {
            return new NotFoundResult();
        }

        db.GroupUpdates.Remove(update);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }
}
