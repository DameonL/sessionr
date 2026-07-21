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
            .Include(gs => gs.Rsvps)
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
            .Include(gs => gs.Rsvps)
            .SingleOrDefaultAsync(gs => gs.GroupSessionId == sessionId && gs.GroupId == groupId);
        if (session is null)
        {
            return new NotFoundResult();
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
}
