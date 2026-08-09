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

namespace SessionApp.Api.Functions.Groups.ByGroupId.Tunes;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/groups/{groupId}/tunes — add a master tune to the group's repertoire.</summary>
    [Function("AddGroupTune")]
    public async Task<IActionResult> AddGroupTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/tunes")] HttpRequest req,
        Guid groupId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var callerUserId = await req.GetCallerUserIdAsync(db);
        var body = await req.ReadFromJsonAsync<AddGroupTuneRequest>();
        if (body is null || body.TuneId == Guid.Empty)
        {
            return new BadRequestObjectResult("TuneId is required.");
        }

        var tune = await db.Tunes.AsNoTracking().SingleOrDefaultAsync(t => t.TuneId == body.TuneId);
        if (tune is null)
        {
            return new NotFoundObjectResult($"Tune {body.TuneId} not found.");
        }

        var exists = await db.GroupTunes.Where(gt => gt.GroupId == groupId && gt.TuneId == body.TuneId).CosmosAnyAsync();
        if (exists)
        {
            return new ConflictObjectResult("Tune is already in the group's repertoire.");
        }

        var user = await db.Users.AsNoTracking().SingleAsync(u => u.UserId == callerUserId!.Value);

        var groupTune = new GroupTune
        {
            GroupId = groupId,
            TuneId = body.TuneId,
            TuneSettingId = body.TuneSettingId,
            AddedByUserId = callerUserId.Value,
            CreatedAt = DateTime.UtcNow
        };
        db.GroupTunes.Add(groupTune);

        await RecordGroupTuneChangeAsync(db, groupId, callerUserId.Value, GroupFeedEventType.GroupTuneAdded, body.TuneId);

        await db.SaveChangesAsync();

        var setting = body.TuneSettingId.HasValue
            ? await db.TuneSettings.AsNoTracking().SingleOrDefaultAsync(s => s.TuneSettingId == body.TuneSettingId.Value)
            : null;

        return new OkObjectResult(new GroupTuneDto(
            groupTune.GroupTuneId,
            groupTune.TuneId,
            tune.Title,
            tune.TuneType.ToString(),
            setting?.Key ?? tune.Key,
            groupTune.TuneSettingId,
            setting?.SubmitterName,
            user.DisplayName
        ));
    }
}
