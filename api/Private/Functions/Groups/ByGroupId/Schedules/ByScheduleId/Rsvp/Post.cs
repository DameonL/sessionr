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

namespace SessionApp.Api.Functions.Groups.ByGroupId.Schedules.ByScheduleId.Rsvp;

public class Post(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
    /// <summary>POST /api/groups/{groupId}/schedules/{scheduleId}/rsvp — RSVP to a specific date of a recurring schedule, instantiating a GroupSession if needed.</summary>
    [Function("RsvpToGroupScheduleDate")]
    public async Task<IActionResult> RsvpToGroupScheduleDate(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/schedules/{scheduleId:guid}/rsvp")] HttpRequest req,
        Guid groupId, Guid scheduleId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<RsvpScheduleDateRequest>();
        if (body is null || !Enum.TryParse<RsvpStatus>(body.Status, out var status) || !DateTime.TryParse(body.Date, out var parsedDate))
        {
            return new BadRequestObjectResult("A valid Status and Date (YYYY-MM-DD) are required.");
        }

        if (!await db.IsActiveMemberAsync(groupId, callerUserId.Value))
        {
            return Forbidden("Only group members can RSVP.");
        }

        var schedule = await db.GroupMeetingSchedules.SingleOrDefaultAsync(s => s.GroupMeetingScheduleId == scheduleId && s.GroupId == groupId);
        if (schedule is null)
        {
            return new NotFoundResult();
        }

        var group = await db.Groups.AsNoTracking().SingleOrDefaultAsync(g => g.GroupId == groupId);
        var timeZoneId = group?.TimeZone ?? "UTC";

        var utcStartsAt = Me.UpcomingMeetings.Get.ConvertLocalToUtc(parsedDate, schedule.MeetingTime, timeZoneId);
        if (utcStartsAt < DateTime.UtcNow)
        {
            return new BadRequestObjectResult("Cannot adjust RSVP status for past events.");
        }

        var session = await db.GroupSessions
            .FirstOrDefaultAsync(gs => gs.GroupId == groupId && gs.StartsAt == utcStartsAt);

        if (session is null)
        {
            session = new GroupSession
            {
                GroupId = groupId,
                Title = !string.IsNullOrWhiteSpace(schedule.MeetingScheduleText) ? schedule.MeetingScheduleText : "Group Meeting",
                StartsAt = utcStartsAt,
                Notes = schedule.MeetingDescription,
                CreatedByUserId = callerUserId.Value,
            };
            db.GroupSessions.Add(session);
            await db.SaveChangesAsync();
        }

        // RSVPs are separate documents; fetch this user's directly rather than via session.Rsvps.
        var rsvp = await db.SessionRsvps
            .SingleOrDefaultAsync(r => r.GroupSessionId == session.GroupSessionId && r.UserId == callerUserId.Value);
        if (rsvp is null)
        {
            rsvp = new SessionRsvp { GroupSessionId = session.GroupSessionId, UserId = callerUserId.Value };
            db.SessionRsvps.Add(rsvp);
        }
        rsvp.Status = status;
        rsvp.RespondedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();
        await purgeService.PurgeGroupDetailAsync(groupId);

        await GroupSessionSupport.PopulateAsync(db, session);
        return new OkObjectResult(GroupSessionSupport.ToDto(session, callerUserId.Value));
    }
}
