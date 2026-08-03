using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Sessions.BySessionId.Rsvp;

public class Post(AppDbContext db)
{
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
            .SingleOrDefaultAsync(gs => gs.GroupSessionId == sessionId && gs.GroupId == groupId);
        if (session is null)
        {
            return new NotFoundResult();
        }

        if (session.StartsAt < DateTime.UtcNow)
        {
            return new BadRequestObjectResult("Cannot adjust RSVP status for past events.");
        }

        // RSVPs are separate documents; fetch this user's directly rather than via session.Rsvps.
        var rsvp = await db.SessionRsvps
            .SingleOrDefaultAsync(r => r.GroupSessionId == sessionId && r.UserId == callerUserId.Value);
        if (rsvp is null)
        {
            rsvp = new SessionRsvp { GroupSessionId = sessionId, UserId = callerUserId.Value };
            db.SessionRsvps.Add(rsvp);
        }
        rsvp.Status = status;
        rsvp.RespondedAt = DateTime.UtcNow;

        await db.SaveChangesAsync();

        await GroupSessionSupport.PopulateAsync(db, session);
        return new OkObjectResult(GroupSessionSupport.ToDto(session, callerUserId.Value));
    }
}
