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

namespace SessionApp.Api.Functions.Groups.ByGroupId.Sessions.BySessionId;

public class Patch(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
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

        await purgeService.PurgeGroupDetailAsync(groupId);

        await GroupSessionSupport.PopulateAsync(db, session);
        return new OkObjectResult(GroupSessionSupport.ToDto(session, callerUserId.Value));
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
