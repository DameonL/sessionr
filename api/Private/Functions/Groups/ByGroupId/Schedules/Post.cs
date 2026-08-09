using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Schedules;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/groups/{groupId}/schedules — add a new recurring meeting schedule to the group.</summary>
    [Function("CreateGroupMeetingSchedule")]
    public async Task<IActionResult> CreateGroupMeetingSchedule(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/schedules")] HttpRequest req,
        Guid groupId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var groupExists = await db.Groups.Where(g => g.GroupId == groupId).CosmosAnyAsync();
        if (!groupExists)
        {
            return new NotFoundResult();
        }

        var body = await req.ReadFromJsonAsync<CreateGroupScheduleRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request payload is required.");
        }

        var schedule = new GroupMeetingSchedule
        {
            GroupId = groupId,
            Name = string.IsNullOrWhiteSpace(body.Name) ? null : body.Name.Trim(),
            RecurrencePattern = body.RecurrencePattern,
            RecurrenceDayOfWeek = body.RecurrenceDayOfWeek,
            RecurrenceWeekOfMonth = body.RecurrenceWeekOfMonth,
            StartDate = body.StartDate,
            MeetingTime = body.MeetingTime,
            MeetingScheduleText = string.IsNullOrWhiteSpace(body.MeetingScheduleText) ? null : body.MeetingScheduleText.Trim(),
            MeetingDescription = string.IsNullOrWhiteSpace(body.MeetingDescription) ? null : body.MeetingDescription.Trim()
        };

        db.GroupMeetingSchedules.Add(schedule);
        await db.SaveChangesAsync();

        return new OkObjectResult(new GroupMeetingScheduleDto(
            schedule.GroupMeetingScheduleId,
            schedule.GroupId,
            schedule.RecurrencePattern,
            schedule.RecurrenceDayOfWeek,
            schedule.RecurrenceWeekOfMonth,
            schedule.StartDate,
            schedule.MeetingTime,
            schedule.MeetingScheduleText,
            schedule.MeetingDescription,
            [],
            schedule.Name));
    }
}
