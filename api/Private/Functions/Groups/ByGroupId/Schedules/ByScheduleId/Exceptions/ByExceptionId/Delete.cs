using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Schedules.ByScheduleId.Exceptions.ByExceptionId;

public class Delete(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
    /// <summary>DELETE /api/groups/{groupId}/schedules/{scheduleId}/exceptions/{exceptionId} — remove a date exception from a schedule.</summary>
    [Function("DeleteGroupScheduleException")]
    public async Task<IActionResult> DeleteGroupScheduleException(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/schedules/{scheduleId:guid}/exceptions/{exceptionId:guid}")] HttpRequest req,
        Guid groupId,
        Guid scheduleId,
        Guid exceptionId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var exception = await db.GroupScheduleExceptions
            .SingleOrDefaultAsync(gse => gse.GroupScheduleExceptionId == exceptionId && gse.GroupMeetingScheduleId == scheduleId && gse.GroupMeetingSchedule.GroupId == groupId);
        if (exception is null)
        {
            return new NotFoundResult();
        }

        db.GroupScheduleExceptions.Remove(exception);
        await db.SaveChangesAsync();
        await purgeService.PurgeGroupDetailAsync(groupId);
        return new NoContentResult();
    }
}
