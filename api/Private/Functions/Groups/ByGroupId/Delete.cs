using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId;

public class Delete(AppDbContext db)
{
    /// <summary>DELETE /api/groups/{groupId} — delete a group. Only the Owner can delete the group.</summary>
    [Function("DeleteGroup")]
    public async Task<IActionResult> DeleteGroup(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}")] HttpRequest req,
        Guid groupId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner);
        if (authResult is not null)
        {
            return authResult;
        }

        var group = await db.Groups.SingleOrDefaultAsync(g => g.GroupId == groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        db.Groups.Remove(group);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }
}
