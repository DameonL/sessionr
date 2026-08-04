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

namespace SessionApp.Api.Functions.Me.UpcomingMeetings;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/me/upcoming-meetings — lightweight query of upcoming group meetings in the next 7 days for the caller's active groups.</summary>
    [Function("GetUpcomingMeetings")]
    public async Task<IActionResult> GetUpcomingMeetings(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "me/upcoming-meetings")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }
        var userId = callerUserId.Value;

        var userMemberships = await db.GroupMemberships
            .AsNoTracking()
            .Where(m => m.UserId == userId && m.Status == GroupMembershipStatus.Active)
            .Select(m => m.GroupId)
            .ToListAsync();

        if (userMemberships.Count == 0)
        {
            return new OkObjectResult(new List<UpcomingMeetingDto>());
        }

        var groupIds = userMemberships.Distinct().ToList();
        var groups = await db.Groups
            .AsNoTracking()
            .Where(g => groupIds.Contains(g.GroupId))
            .ToDictionaryByIdAsync(g => g.GroupId);

        var groupMap = groupIds.ToDictionary(id => id, id => new
        {
            GroupId = id,
            Name = groups.TryGetValue(id, out var g) ? g.Name : "",
            TimeZone = (groups.TryGetValue(id, out g) ? g.TimeZone : null) ?? "UTC"
        });

        var nowUtc = DateTime.UtcNow;
        var endUtc = nowUtc.AddDays(7);

        var sessionEntities = await db.GroupSessions
            .AsNoTracking()
            .Where(gs => groupIds.Contains(gs.GroupId) && gs.StartsAt >= nowUtc && gs.StartsAt <= endUtc && !gs.IsCancelled)
            .ToListAsync();

        var sessionIds = sessionEntities.Select(s => s.GroupSessionId).ToList();
        var rsvps = sessionIds.Count == 0
            ? new List<SessionRsvp>()
            : await db.SessionRsvps
                .AsNoTracking()
                .Where(r => sessionIds.Contains(r.GroupSessionId))
                .ToListAsync();

        var rsvpsBySession = rsvps.ToLookup(r => r.GroupSessionId);

        var result = new List<UpcomingMeetingDto>();
        var existingSessionDates = new HashSet<string>();

        foreach (var s in sessionEntities)
        {
            var sessionRsvps = rsvpsBySession[s.GroupSessionId].ToList();
            var viewerRsvpStatus = sessionRsvps.FirstOrDefault(r => r.UserId == userId)?.Status;
            var goingCount = sessionRsvps.Count(r => r.Status == RsvpStatus.Going);
            var maybeCount = sessionRsvps.Count(r => r.Status == RsvpStatus.Maybe);

            var group = groupMap[s.GroupId];
            result.Add(new UpcomingMeetingDto(
                s.GroupId,
                group.Name,
                s.GroupSessionId,
                null,
                s.Title,
                s.Location,
                s.StartsAt,
                s.IsCancelled,
                viewerRsvpStatus?.ToString(),
                goingCount,
                maybeCount));

            existingSessionDates.Add($"{s.GroupId}:{s.StartsAt:yyyy-MM-dd}");
        }

        var scheduleEntities = await db.GroupMeetingSchedules
            .AsNoTracking()
            .Where(gms => groupIds.Contains(gms.GroupId) && gms.RecurrencePattern != RecurrencePattern.None)
            .ToListAsync();

        var scheduleIds = scheduleEntities.Select(s => s.GroupMeetingScheduleId).ToList();
        var exceptions = scheduleIds.Count == 0
            ? new List<GroupScheduleException>()
            : await db.GroupScheduleExceptions
                .AsNoTracking()
                .Where(e => scheduleIds.Contains(e.GroupMeetingScheduleId))
                .ToListAsync();

        var exceptionsBySchedule = exceptions.ToLookup(e => e.GroupMeetingScheduleId);

        var scheduleRows = scheduleEntities.Select(gms => new
        {
            gms.GroupMeetingScheduleId,
            gms.GroupId,
            gms.RecurrencePattern,
            gms.RecurrenceDayOfWeek,
            gms.RecurrenceWeekOfMonth,
            gms.StartDate,
            gms.MeetingTime,
            gms.MeetingScheduleText,
            gms.MeetingDescription,
            ExceptionDates = exceptionsBySchedule[gms.GroupMeetingScheduleId].Select(e => e.ExceptionDate.Date).ToList()
        }).ToList();

        var today = nowUtc.Date;
        for (int i = 0; i <= 7; i++)
        {
            var checkDate = today.AddDays(i);
            foreach (var sch in scheduleRows)
            {
                if (sch.ExceptionDates.Contains(checkDate.Date)) continue;

                bool matches = sch.RecurrencePattern switch
                {
                    RecurrencePattern.Weekly => sch.RecurrenceDayOfWeek.HasValue && checkDate.DayOfWeek == sch.RecurrenceDayOfWeek.Value,
                    RecurrencePattern.Biweekly => sch.RecurrenceDayOfWeek.HasValue && checkDate.DayOfWeek == sch.RecurrenceDayOfWeek.Value && (((checkDate - (sch.StartDate ?? checkDate)).Days / 7) % 2 == 0),
                    RecurrencePattern.MonthlyNthDay => sch.RecurrenceDayOfWeek.HasValue && sch.RecurrenceWeekOfMonth.HasValue && checkDate.DayOfWeek == sch.RecurrenceDayOfWeek.Value && ((checkDate.Day - 1) / 7 + 1) == sch.RecurrenceWeekOfMonth.Value,
                    RecurrencePattern.SpecificDate => sch.StartDate.HasValue && sch.StartDate.Value.Date == checkDate.Date,
                    _ => false
                };

                if (!matches) continue;

                var group = groupMap[sch.GroupId];
                var utcStartsAt = ConvertLocalToUtc(checkDate, sch.MeetingTime, group.TimeZone);

                if (utcStartsAt < nowUtc || utcStartsAt > endUtc) continue;

                var dateKey = $"{sch.GroupId}:{utcStartsAt:yyyy-MM-dd}";
                if (existingSessionDates.Contains(dateKey)) continue;

                result.Add(new UpcomingMeetingDto(
                    sch.GroupId,
                    group.Name,
                    null,
                    sch.GroupMeetingScheduleId,
                    !string.IsNullOrWhiteSpace(sch.MeetingScheduleText) ? sch.MeetingScheduleText : "Group Meeting",
                    null,
                    utcStartsAt,
                    false,
                    null,
                    0,
                    0));
            }
        }

        result = result.OrderBy(m => m.StartsAt).ToList();
        return new OkObjectResult(result);
    }

    internal static DateTime ConvertLocalToUtc(DateTime date, string? timeStr, string? timeZoneId)
    {
        TimeZoneInfo tz;
        if (!string.IsNullOrWhiteSpace(timeZoneId))
        {
            try
            {
                tz = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
            }
            catch
            {
                tz = TimeZoneInfo.Utc;
            }
        }
        else
        {
            tz = TimeZoneInfo.Utc;
        }

        TimeSpan timeOfDay = TimeSpan.Zero;
        if (!string.IsNullOrWhiteSpace(timeStr) && TimeSpan.TryParse(timeStr, out var parsedTime))
        {
            timeOfDay = parsedTime;
        }

        var unspecified = new DateTime(date.Year, date.Month, date.Day, timeOfDay.Hours, timeOfDay.Minutes, timeOfDay.Seconds, DateTimeKind.Unspecified);
        return TimeZoneInfo.ConvertTimeToUtc(unspecified, tz);
    }
}
