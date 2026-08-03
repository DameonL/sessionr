using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Schedules.Replace;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/groups/{groupId}/schedules/replace — atomically replace all schedules for a group.</summary>
    [Function("ReplaceGroupSchedules")]
    public async Task<IActionResult> ReplaceGroupSchedules(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/schedules/replace")] HttpRequest req,
        Guid groupId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var groupExists = await db.Groups.AnyAsync(g => g.GroupId == groupId);
        if (!groupExists)
        {
            return new NotFoundResult();
        }

        var body = await req.ReadFromJsonAsync<ReplaceGroupSchedulesRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request payload is required.");
        }

        var existingSchedules = await db.GroupMeetingSchedules
            .Where(s => s.GroupId == groupId)
            .ToListAsync();

        // Exceptions are separate Cosmos documents, so delete them explicitly (no cascade delete).
        var existingScheduleIds = existingSchedules.Select(s => s.GroupMeetingScheduleId).ToList();
        if (existingScheduleIds.Count > 0)
        {
            var existingExceptions = await db.GroupScheduleExceptions
                .Where(e => existingScheduleIds.Contains(e.GroupMeetingScheduleId))
                .ToListAsync();
            db.GroupScheduleExceptions.RemoveRange(existingExceptions);
        }
        db.GroupMeetingSchedules.RemoveRange(existingSchedules);

        var newSchedules = new List<GroupMeetingSchedule>();
        foreach (var reqSched in body.Schedules)
        {
            var sched = new GroupMeetingSchedule
            {
                GroupId = groupId,
                Name = string.IsNullOrWhiteSpace(reqSched.Name) ? null : reqSched.Name.Trim(),
                RecurrencePattern = reqSched.RecurrencePattern,
                RecurrenceDayOfWeek = reqSched.RecurrenceDayOfWeek,
                RecurrenceWeekOfMonth = reqSched.RecurrenceWeekOfMonth,
                StartDate = reqSched.StartDate,
                MeetingTime = reqSched.MeetingTime,
                MeetingScheduleText = string.IsNullOrWhiteSpace(reqSched.MeetingScheduleText) ? null : reqSched.MeetingScheduleText.Trim(),
                MeetingDescription = string.IsNullOrWhiteSpace(reqSched.MeetingDescription) ? null : reqSched.MeetingDescription.Trim()
            };

            newSchedules.Add(sched);
        }

        db.GroupMeetingSchedules.AddRange(newSchedules);
        await db.SaveChangesAsync();

        var dtos = newSchedules.Select(s => new GroupMeetingScheduleDto(
            s.GroupMeetingScheduleId,
            s.GroupId,
            s.RecurrencePattern,
            s.RecurrenceDayOfWeek,
            s.RecurrenceWeekOfMonth,
            s.StartDate,
            s.MeetingTime,
            s.MeetingScheduleText,
            s.MeetingDescription,
            [],
            s.Name
        )).ToList();

        return new OkObjectResult(dtos);
    }
}
