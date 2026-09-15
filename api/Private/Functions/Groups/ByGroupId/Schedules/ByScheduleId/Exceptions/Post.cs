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

namespace SessionApp.Api.Functions.Groups.ByGroupId.Schedules.ByScheduleId.Exceptions;

public class Post(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
    /// <summary>POST /api/groups/{groupId}/schedules/{scheduleId}/exceptions — add a date exception to a meeting schedule.</summary>
    [Function("AddGroupScheduleException")]
    public async Task<IActionResult> AddGroupScheduleException(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/schedules/{scheduleId:guid}/exceptions")] HttpRequest req,
        Guid groupId,
        Guid scheduleId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var scheduleExists = await db.GroupMeetingSchedules
            .Where(gms => gms.GroupMeetingScheduleId == scheduleId && gms.GroupId == groupId)
            .CosmosAnyAsync();
        if (!scheduleExists)
        {
            return new NotFoundResult();
        }

        var body = await req.ReadFromJsonAsync<CreateGroupScheduleExceptionRequest>();
        if (body is null || body.ExceptionDate == default)
        {
            return new BadRequestObjectResult("ExceptionDate is required.");
        }

        var exception = new GroupScheduleException
        {
            GroupMeetingScheduleId = scheduleId,
            ExceptionDate = body.ExceptionDate
        };

        db.GroupScheduleExceptions.Add(exception);
        await db.SaveChangesAsync();
        await purgeService.PurgeGroupDetailAsync(groupId);

        return new OkObjectResult(new GroupScheduleExceptionDto(
            exception.GroupScheduleExceptionId,
            exception.GroupMeetingScheduleId,
            exception.ExceptionDate));
    }
}
