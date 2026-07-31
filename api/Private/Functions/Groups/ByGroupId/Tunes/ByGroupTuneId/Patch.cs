using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Tunes.ByGroupTuneId;

public class Patch(AppDbContext db)
{
    /// <summary>PATCH /api/groups/{groupId}/tunes/{groupTuneId} — update setting on a group tune. Admin/Owner only.</summary>
    [Function("UpdateGroupTune")]
    public async Task<IActionResult> UpdateGroupTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "groups/{groupId:guid}/tunes/{groupTuneId:guid}")] HttpRequest req,
        Guid groupId,
        Guid groupTuneId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var groupTune = await db.GroupTunes.SingleOrDefaultAsync(gt => gt.GroupTuneId == groupTuneId && gt.GroupId == groupId);
        if (groupTune is null)
        {
            return new NotFoundResult();
        }

        var body = await req.ReadFromJsonAsync<UpdateGroupTuneRequest>();
        groupTune.TuneSettingId = body?.TuneSettingId;

        await db.SaveChangesAsync();
        return new OkObjectResult(new { groupTune.GroupTuneId, groupTune.TuneSettingId });
    }
}
