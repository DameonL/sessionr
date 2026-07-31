using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.GroupFeedSupport;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Tunes.ByGroupTuneId;

public class Delete(AppDbContext db)
{
    /// <summary>DELETE /api/groups/{groupId}/tunes/{groupTuneId} — remove a tune from the group's repertoire. Admin/Owner only.</summary>
    [Function("RemoveGroupTune")]
    public async Task<IActionResult> RemoveGroupTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/tunes/{groupTuneId:guid}")] HttpRequest req,
        Guid groupId,
        Guid groupTuneId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var callerUserId = await req.GetCallerUserIdAsync(db);

        var groupTune = await db.GroupTunes.SingleOrDefaultAsync(gt => gt.GroupTuneId == groupTuneId && gt.GroupId == groupId);
        if (groupTune is null)
        {
            return new NotFoundResult();
        }

        var removedTuneId = groupTune.TuneId;

        db.GroupTunes.Remove(groupTune);

        await RecordGroupTuneChangeAsync(db, groupId, callerUserId!.Value, GroupFeedEventType.GroupTuneRemoved, removedTuneId);

        await db.SaveChangesAsync();
        return new NoContentResult();
    }
}
