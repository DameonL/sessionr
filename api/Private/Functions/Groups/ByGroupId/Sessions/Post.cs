using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Sessions;

public class Post(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
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
        await purgeService.PurgeGroupDetailAsync(groupId);

        var groupTimeZone = await db.Groups.Where(g => g.GroupId == groupId).Select(g => g.TimeZone).FirstOrDefaultAsync();
        await GroupFeedSupport.RecordGroupEventAsync(db, groupId, callerUserId.Value, GroupFeedEventType.SessionScheduled,
            new GroupSessionFeedPayload(sessions[0].Title, FormatInGroupTimeZone(sessions[0].StartsAt, groupTimeZone), sessions.Count));

        var createdByUser = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.UserId == callerUserId.Value);
        return new OkObjectResult(sessions.Select(gs => GroupSessionSupport.ToDto(gs, callerUserId.Value, createdByUser?.DisplayName ?? "Member")).ToList());
    }

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
}
