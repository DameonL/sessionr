using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.GroupAuthorization;

namespace SessionApp.Api.Functions;

/// <summary>Schedule, edit, cancel, delete, and RSVP to a group's real-world sessions. Mutations require an admin/owner actor (RSVP requires any active member).</summary>
public class PrivateGroupSessionFunctions(AppDbContext db)
{
    /// <summary>
    /// POST /api/groups/{groupId}/sessions — schedule a session. Admin/owner only.
    /// Set RepeatWeeks &gt; 1 to create that many weekly-spaced occurrences at once.
    /// </summary>
    [Function("CreateGroupSession")]
    public async Task<IActionResult> CreateGroupSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/sessions")] HttpRequest req,
        Guid groupId)
    {
        var body = await req.ReadFromJsonAsync<CreateSessionRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Title))
        {
            return new BadRequestObjectResult("Title is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, body.UserId);
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
                CreatedByUserId = body.UserId,
            })
            .ToList();

        db.GroupSessions.AddRange(sessions);
        await db.SaveChangesAsync();

        var createdByUser = await db.Users.AsNoTracking().SingleAsync(u => u.UserId == body.UserId);
        return new OkObjectResult(sessions.Select(gs => GroupSessionSupport.ToDto(gs, body.UserId, createdByUser.DisplayName)).ToList());
    }

    /// <summary>PATCH /api/groups/{groupId}/sessions/{sessionId} — edit or cancel a session. Admin/owner only.</summary>
    [Function("UpdateGroupSession")]
    public async Task<IActionResult> UpdateGroupSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "groups/{groupId:guid}/sessions/{sessionId:guid}")] HttpRequest req,
        Guid groupId, Guid sessionId)
    {
        var body = await req.ReadFromJsonAsync<UpdateSessionRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("UserId is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, body.UserId);
        if (!actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators can edit sessions.");
        }

        var session = await db.GroupSessions
            .Include(gs => gs.CreatedByUser)
            .Include(gs => gs.Rsvps)
            .SingleOrDefaultAsync(gs => gs.GroupSessionId == sessionId && gs.GroupId == groupId);
        if (session is null)
        {
            return new NotFoundResult();
        }

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
            session.IsCancelled = body.IsCancelled.Value;
        }

        await db.SaveChangesAsync();

        return new OkObjectResult(GroupSessionSupport.ToDto(session, body.UserId));
    }

    /// <summary>DELETE /api/groups/{groupId}/sessions/{sessionId}?userId= — admin/owner only.</summary>
    [Function("DeleteGroupSession")]
    public async Task<IActionResult> DeleteGroupSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/sessions/{sessionId:guid}")] HttpRequest req,
        Guid groupId, Guid sessionId)
    {
        Guid.TryParse(req.Query["userId"], out var userId);

        var actorRole = await db.GetRoleAsync(groupId, userId);
        if (!actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators can delete sessions.");
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
        var body = await req.ReadFromJsonAsync<RsvpRequest>();
        if (body is null || !Enum.TryParse<RsvpStatus>(body.Status, out var status))
        {
            return new BadRequestObjectResult("A valid Status (Going, Maybe, NotGoing) is required.");
        }

        if (!await db.IsActiveMemberAsync(groupId, body.UserId))
        {
            return Forbidden("Only group members can RSVP.");
        }

        var session = await db.GroupSessions
            .Include(gs => gs.CreatedByUser)
            .Include(gs => gs.Rsvps)
            .SingleOrDefaultAsync(gs => gs.GroupSessionId == sessionId && gs.GroupId == groupId);
        if (session is null)
        {
            return new NotFoundResult();
        }

        var rsvp = session.Rsvps.FirstOrDefault(r => r.UserId == body.UserId);
        if (rsvp is null)
        {
            // EF's navigation fixup adds this to session.Rsvps automatically since
            // the GroupSession is already tracked with its Rsvps collection loaded.
            rsvp = new SessionRsvp { GroupSessionId = sessionId, UserId = body.UserId };
            db.SessionRsvps.Add(rsvp);
        }
        rsvp.Status = status;
        rsvp.RespondedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();

        return new OkObjectResult(GroupSessionSupport.ToDto(session, body.UserId));
    }
}
