using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;


namespace SessionApp.Api.Functions;

/// <summary>Schedule, edit, cancel, delete, and RSVP to a group's real-world sessions. Mutations require an admin/owner actor (RSVP requires any active member).</summary>
public class PrivateGroupSessionFunctions(AppDbContext db)
{
    /// <summary>GET /api/groups/{groupId}/sessions — upcoming and past sessions with the caller's own RSVP status (requires sign-in).</summary>
    [Function("GetGroupSessions")]
    public async Task<IActionResult> GetGroupSessions(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groups/{groupId:guid}/sessions")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }
        var userId = callerUserId.Value;

        var group = await db.Groups.AsNoTracking().SingleOrDefaultAsync(g => g.GroupId == groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }
        if (group.IsPrivate && !await db.IsActiveMemberAsync(groupId, userId))
        {
            return Forbidden("This is a private group.");
        }

        var sessions = await db.GroupSessions
            .AsNoTracking()
            .Where(gs => gs.GroupId == groupId)
            .Include(gs => gs.CreatedByUser)
            .Include(gs => gs.Rsvps).ThenInclude(r => r.User)
            .OrderBy(gs => gs.StartsAt)
            .ToListAsync();

        return new OkObjectResult(sessions.Select(gs => GroupSessionSupport.ToDto(gs, userId)).ToList());
    }

    /// <summary>
    /// POST /api/groups/{groupId}/sessions — schedule a session. Admin/owner only.
    /// Set RepeatWeeks > 1 to create that many weekly-spaced occurrences at once.
    /// </summary>
    [Function("CreateGroupSession")]
    public async Task<IActionResult> CreateGroupSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/sessions")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<CreateSessionRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Title))
        {
            return new BadRequestObjectResult("Title is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (!actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators can schedule sessions.");
        }

        var repeatWeeks = Math.Clamp(body.RepeatWeeks, 1, 52);
        var sessions = Enumerable.Range(0, repeatWeeks)
            .Select(i => new GroupSession
            {
                GroupId = groupId,
                Title = body.Title.Trim(),
                Location = body.Location?.Trim(),
                StartsAt = body.StartsAt.AddDays(7 * i),
                Notes = body.Notes?.Trim(),
                CreatedByUserId = callerUserId.Value,
            })
            .ToList();

        db.GroupSessions.AddRange(sessions);
        await db.SaveChangesAsync();

        var groupTimeZone = await db.Groups.Where(g => g.GroupId == groupId).Select(g => g.TimeZone).FirstOrDefaultAsync();
        await GroupFeedSupport.RecordGroupEventAsync(db, groupId, callerUserId.Value, GroupFeedEventType.SessionScheduled,
            new GroupSessionFeedPayload(sessions[0].Title, FormatInGroupTimeZone(sessions[0].StartsAt, groupTimeZone), sessions.Count));

        var createdByUser = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.UserId == callerUserId.Value);
        return new OkObjectResult(sessions.Select(gs => GroupSessionSupport.ToDto(gs, callerUserId.Value, createdByUser?.DisplayName ?? "Member")).ToList());
    }

    /// <summary>PATCH /api/groups/{groupId}/sessions/{sessionId} — edit or cancel a session. Admin/owner only.</summary>
    [Function("UpdateGroupSession")]
    public async Task<IActionResult> UpdateGroupSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "groups/{groupId:guid}/sessions/{sessionId:guid}")] HttpRequest req,
        Guid groupId, Guid sessionId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<UpdateSessionRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request payload is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (!actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators can edit sessions.");
        }

        var session = await db.GroupSessions
            .Include(gs => gs.CreatedByUser)
            .Include(gs => gs.Rsvps).ThenInclude(r => r.User)
            .SingleOrDefaultAsync(gs => gs.GroupSessionId == sessionId && gs.GroupId == groupId);
        if (session is null)
        {
            return new NotFoundResult();
        }

        var wasCancelled = session.IsCancelled;

        if (!string.IsNullOrWhiteSpace(body.Title))
        {
            session.Title = body.Title.Trim();
        }
        if (body.Location is not null)
        {
            session.Location = body.Location.Trim();
        }
        if (body.StartsAt is not null)
        {
            session.StartsAt = body.StartsAt.Value;
        }
        if (body.Notes is not null)
        {
            session.Notes = body.Notes.Trim();
        }
        if (body.IsCancelled is not null)
        {
            if (session.StartsAt < DateTime.UtcNow)
            {
                return new BadRequestObjectResult("Cannot cancel or modify past events.");
            }
            session.IsCancelled = body.IsCancelled.Value;
        }

        await db.SaveChangesAsync();

        if (body.IsCancelled == true && !wasCancelled)
        {
            var groupTimeZone = await db.Groups.Where(g => g.GroupId == groupId).Select(g => g.TimeZone).FirstOrDefaultAsync();
            await GroupFeedSupport.RecordGroupEventAsync(db, groupId, callerUserId.Value, GroupFeedEventType.SessionCancelled,
                new GroupSessionFeedPayload(session.Title, FormatInGroupTimeZone(session.StartsAt, groupTimeZone)));
        }

        return new OkObjectResult(GroupSessionSupport.ToDto(session, callerUserId.Value));
    }

    /// <summary>DELETE /api/groups/{groupId}/sessions/{sessionId} — admin/owner only.</summary>
    [Function("DeleteGroupSession")]
    public async Task<IActionResult> DeleteGroupSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/sessions/{sessionId:guid}")] HttpRequest req,
        Guid groupId, Guid sessionId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId.Value);
        if (!req.IsCallerModerator() && !actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators or moderators can delete sessions.");
        }


        var session = await db.GroupSessions.SingleOrDefaultAsync(gs => gs.GroupSessionId == sessionId && gs.GroupId == groupId);
        if (session is null)
        {
            return new NotFoundResult();
        }

        db.GroupSessions.Remove(session);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }

    /// <summary>POST /api/groups/{groupId}/sessions/{sessionId}/rsvp — set or change the caller's RSVP.</summary>
    [Function("RsvpToGroupSession")]
    public async Task<IActionResult> RsvpToGroupSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/sessions/{sessionId:guid}/rsvp")] HttpRequest req,
        Guid groupId, Guid sessionId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<RsvpRequest>();
        if (body is null || !Enum.TryParse<RsvpStatus>(body.Status, out var status))
        {
            return new BadRequestObjectResult("A valid Status (Going, Maybe, NotGoing) is required.");
        }

        if (!await db.IsActiveMemberAsync(groupId, callerUserId.Value))
        {
            return Forbidden("Only group members can RSVP.");
        }

        var session = await db.GroupSessions
            .Include(gs => gs.CreatedByUser)
            .Include(gs => gs.Rsvps).ThenInclude(r => r.User)
            .SingleOrDefaultAsync(gs => gs.GroupSessionId == sessionId && gs.GroupId == groupId);
        if (session is null)
        {
            return new NotFoundResult();
        }

        if (session.StartsAt < DateTime.UtcNow)
        {
            return new BadRequestObjectResult("Cannot adjust RSVP status for past events.");
        }

        var rsvp = session.Rsvps.FirstOrDefault(r => r.UserId == callerUserId.Value);
        if (rsvp is null)
        {
            rsvp = new SessionRsvp { GroupSessionId = sessionId, UserId = callerUserId.Value };
            db.SessionRsvps.Add(rsvp);
        }
        rsvp.Status = status;
        rsvp.RespondedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();

        return new OkObjectResult(GroupSessionSupport.ToDto(session, callerUserId.Value));
    }

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

        var utcStartsAt = ConvertLocalToUtc(parsedDate, schedule.MeetingTime, timeZoneId);
        if (utcStartsAt < DateTime.UtcNow)
        {
            return new BadRequestObjectResult("Cannot adjust RSVP status for past events.");
        }

        var session = await db.GroupSessions
            .Include(gs => gs.CreatedByUser)
            .Include(gs => gs.Rsvps).ThenInclude(r => r.User)
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

            session = await db.GroupSessions
                .Include(gs => gs.CreatedByUser)
                .Include(gs => gs.Rsvps).ThenInclude(r => r.User)
                .SingleAsync(gs => gs.GroupSessionId == session.GroupSessionId);
        }

        var rsvp = session.Rsvps.FirstOrDefault(r => r.UserId == callerUserId.Value);
        if (rsvp is null)
        {
            rsvp = new SessionRsvp { GroupSessionId = session.GroupSessionId, UserId = callerUserId.Value };
            db.SessionRsvps.Add(rsvp);
        }
        rsvp.Status = status;
        rsvp.RespondedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();

        return new OkObjectResult(GroupSessionSupport.ToDto(session, callerUserId.Value));
    }

    private static DateTime ConvertLocalToUtc(DateTime date, string? timeStr, string? timeZoneId)
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

    /// <summary>Formats a UTC session start in the group's timezone for a human-readable feed line (falls back to UTC on an unknown zone id).</summary>
    private static string FormatInGroupTimeZone(DateTime startsAtUtc, string? timeZoneId)
    {
        TimeZoneInfo tz;
        try
        {
            tz = string.IsNullOrWhiteSpace(timeZoneId) ? TimeZoneInfo.Utc : TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch
        {
            tz = TimeZoneInfo.Utc;
        }

        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(startsAtUtc, DateTimeKind.Utc), tz);
        return local.ToString("ddd, MMM d, h:mm tt");
    }

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

        // 1. Get user's active groups (lightweight projection)
        var userGroups = await db.GroupMemberships
            .AsNoTracking()
            .Where(m => m.UserId == userId && m.Status == GroupMembershipStatus.Active)
            .Select(m => new { m.GroupId, m.Group.Name, TimeZone = m.Group.TimeZone ?? "UTC" })
            .ToListAsync();

        if (userGroups.Count == 0)
        {
            return new OkObjectResult(new List<UpcomingMeetingDto>());
        }

        var groupIds = userGroups.Select(g => g.GroupId).ToList();
        var groupMap = userGroups.ToDictionary(g => g.GroupId);

        var nowUtc = DateTime.UtcNow;
        var endUtc = nowUtc.AddDays(7);

        // 2. Query explicit GroupSessions in [now, now + 7 days] for user's groups
        var sessionRows = await db.GroupSessions
            .AsNoTracking()
            .Where(gs => groupIds.Contains(gs.GroupId) && gs.StartsAt >= nowUtc && gs.StartsAt <= endUtc && !gs.IsCancelled)
            .Select(gs => new
            {
                gs.GroupSessionId,
                gs.GroupId,
                gs.Title,
                gs.Location,
                gs.StartsAt,
                gs.IsCancelled,
                ViewerRsvpStatus = gs.Rsvps.Where(r => r.UserId == userId).Select(r => (RsvpStatus?)r.Status).FirstOrDefault(),
                GoingCount = gs.Rsvps.Count(r => r.Status == RsvpStatus.Going),
                MaybeCount = gs.Rsvps.Count(r => r.Status == RsvpStatus.Maybe)
            })
            .ToListAsync();

        var result = new List<UpcomingMeetingDto>();
        var existingSessionDates = new HashSet<string>();

        foreach (var s in sessionRows)
        {
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
                s.ViewerRsvpStatus?.ToString(),
                s.GoingCount,
                s.MaybeCount));

            existingSessionDates.Add($"{s.GroupId}:{s.StartsAt:yyyy-MM-dd}");
        }

        // 3. Query active GroupMeetingSchedules
        var scheduleRows = await db.GroupMeetingSchedules
            .AsNoTracking()
            .Where(gms => groupIds.Contains(gms.GroupId) && gms.RecurrencePattern != RecurrencePattern.None)
            .Select(gms => new
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
                ExceptionDates = gms.Exceptions.Select(e => e.ExceptionDate.Date).ToList()
            })
            .ToListAsync();

        // 4. Compute upcoming schedule occurrences for next 7 days in memory
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

    /// <summary>GET /api/me/dashboard-summary — consolidated lightweight query for practice streak, group feed events, top rusty tunes, and pending group requests.</summary>
    [Function("GetDashboardSummary")]
    public async Task<IActionResult> GetDashboardSummary(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "me/dashboard-summary")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }
        var userId = callerUserId.Value;

        // 1. Practice Streak
        var user = await db.Users.AsNoTracking().Where(u => u.UserId == userId).Select(u => new { u.CurrentStreak }).FirstOrDefaultAsync();
        var currentStreakDays = user?.CurrentStreak ?? 0;

        // 2. Active group IDs for user
        var userGroupMemberships = await db.GroupMemberships
            .AsNoTracking()
            .Where(m => m.UserId == userId && m.Status == GroupMembershipStatus.Active)
            .Select(m => new { m.GroupId, m.Role })
            .ToListAsync();

        var activeGroupIds = userGroupMemberships.Select(m => m.GroupId).ToList();

        // 3. Recent Group Activity Feed (top 5)
        var recentActivity = new List<DashboardActivityFeedItemDto>();
        if (activeGroupIds.Count > 0)
        {
            var recentActivityEvents = await db.GroupFeedEvents
                .AsNoTracking()
                .Where(fe => activeGroupIds.Contains(fe.GroupId))
                .OrderByDescending(fe => fe.CreatedAt)
                .Take(5)
                .Select(fe => new {
                    fe.GroupFeedEventId,
                    fe.GroupId,
                    GroupName = fe.Group.Name,
                    EventType = fe.EventType,
                    fe.Payload,
                    MemberName = fe.User.DisplayName,
                    fe.CreatedAt
                })
                .ToListAsync();

            var activityTuneTitles = await GroupFeedSupport.ResolveTuneTitlesAsync(db, recentActivityEvents.Select(fe => fe.Payload));

            recentActivity = recentActivityEvents.Select(fe => new DashboardActivityFeedItemDto(
                fe.GroupFeedEventId,
                fe.GroupId,
                fe.GroupName,
                fe.EventType.ToString(),
                GroupFeedSupport.BuildSummaryText(fe.EventType, fe.MemberName, fe.Payload, GroupFeedSupport.TitlesForEvent(fe.EventType, fe.Payload, activityTuneTitles)),
                fe.CreatedAt)).ToList();
        }

        // 4. Top Rusty Tunes (top 3)
        var rustyCutoff = DateTime.UtcNow.AddDays(-14);
        var topRustyTunes = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == userId && ut.Status == TuneStatus.Active && (ut.LastPracticed == null || ut.LastPracticed < rustyCutoff))
            .OrderBy(ut => ut.LastPracticed ?? DateTime.MinValue)
            .Take(3)
            .Select(ut => new DashboardRustyTuneDto(
                ut.UserTuneId,
                ut.Tune.Title,
                ut.Tune.TuneType.ToString(),
                ut.LastPracticed))
            .ToListAsync();

        // 5. Pending Group Join Requests for groups where caller is Owner or Administrator
        var adminGroupIds = userGroupMemberships
            .Where(m => m.Role == GroupRole.Owner || m.Role == GroupRole.Administrator)
            .Select(m => m.GroupId)
            .ToList();

        var pendingGroupRequests = adminGroupIds.Count > 0
            ? await db.GroupMemberships
                .AsNoTracking()
                .Where(m => adminGroupIds.Contains(m.GroupId) && m.Status == GroupMembershipStatus.Pending)
                .GroupBy(m => new { m.GroupId, m.Group.Name })
                .Select(g => new DashboardPendingRequestDto(g.Key.GroupId, g.Key.Name, g.Count()))
                .ToListAsync()
            : new List<DashboardPendingRequestDto>();

        // 6. Recent Friend Activity
        var friendUserIds = await db.Friendships
            .AsNoTracking()
            .Where(f => f.Status == FriendshipStatus.Accepted && (f.RequesterId == userId || f.ReceiverId == userId))
            .Select(f => f.RequesterId == userId ? f.ReceiverId : f.RequesterId)
            .ToListAsync();

        var recentFriendActivity = new List<DashboardFriendActivityDto>();
        if (friendUserIds.Count > 0)
        {
            var cutoff = DateTime.UtcNow.AddDays(-30);

            var rsvps = await db.SessionRsvps
                .AsNoTracking()
                .Where(r => friendUserIds.Contains(r.UserId) && r.RespondedAt >= cutoff)
                .Include(r => r.User)
                .Include(r => r.GroupSession)
                .ThenInclude(s => s.Group)
                .OrderByDescending(r => r.RespondedAt)
                .Take(5)
                .Select(r => new DashboardFriendActivityDto(
                    r.SessionRsvpId,
                    r.UserId,
                    r.User.DisplayName,
                    r.User.Username,
                    "SessionRsvp",
                    $"{r.User.DisplayName} is {(r.Status == RsvpStatus.Going ? "going to" : "a maybe for")} '{r.GroupSession.Title}' in {r.GroupSession.Group.Name}",
                    r.RespondedAt,
                    $"/group/{r.GroupSession.GroupId}"))
                .ToListAsync();

            var tunes = await db.UserTunes
                .AsNoTracking()
                .Where(ut => friendUserIds.Contains(ut.UserId))
                .Include(ut => ut.User)
                .Include(ut => ut.Tune)
                .OrderByDescending(ut => ut.UserTuneId)
                .Take(5)
                .Select(ut => new DashboardFriendActivityDto(
                    ut.UserTuneId,
                    ut.UserId,
                    ut.User.DisplayName,
                    ut.User.Username,
                    "TuneLearned",
                    $"{ut.User.DisplayName} added '{ut.Tune.Title}' ({ut.Tune.TuneType}) to their repertoire",
                    DateTime.UtcNow,
                    $"/tunes/{ut.TuneId}"))
                .ToListAsync();

            var badges = await db.UserBadges
                .AsNoTracking()
                .Where(b => friendUserIds.Contains(b.UserId) && b.EarnedAt >= cutoff)
                .Include(b => b.User)
                .OrderByDescending(b => b.EarnedAt)
                .Take(5)
                .Select(b => new DashboardFriendActivityDto(
                    b.UserBadgeId,
                    b.UserId,
                    b.User.DisplayName,
                    b.User.Username,
                    "BadgeEarned",
                    $"{b.User.DisplayName} earned a new badge!",
                    b.EarnedAt,
                    b.User.Username != null ? $"/profile/{b.User.Username}" : null))
                .ToListAsync();

            var friendships = await db.Friendships
                .AsNoTracking()
                .Where(f => f.Status == FriendshipStatus.Accepted && f.UpdatedAt >= cutoff && (f.RequesterId == userId || f.ReceiverId == userId))
                .Include(f => f.Requester)
                .Include(f => f.Receiver)
                .OrderByDescending(f => f.UpdatedAt)
                .Take(5)
                .Select(f => new {
                    f.FriendshipId,
                    Friend = f.RequesterId == userId ? f.Receiver : f.Requester,
                    f.UpdatedAt
                })
                .Select(f => new DashboardFriendActivityDto(
                    f.FriendshipId,
                    f.Friend.UserId,
                    f.Friend.DisplayName,
                    f.Friend.Username,
                    "NewFriend",
                    $"You and {f.Friend.DisplayName} are now friends!",
                    f.UpdatedAt,
                    f.Friend.Username != null ? $"/profile/{f.Friend.Username}" : null))
                .ToListAsync();

            recentFriendActivity = rsvps
                .Concat(tunes)
                .Concat(badges)
                .Concat(friendships)
                .OrderByDescending(a => a.CreatedAt)
                .Take(10)
                .ToList();
        }

        return new OkObjectResult(new DashboardSummaryDto(currentStreakDays, recentActivity, topRustyTunes, pendingGroupRequests, recentFriendActivity));
    }
}
