using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.GroupAuthorization;

namespace SessionApp.Api.Functions;

/// <summary>Read-only access to a group's scheduled sessions.</summary>
public class PublicGroupSessionFunctions(AppDbContext db)
{
    /// <summary>GET /api/groups/{groupId}/sessions?userId= — upcoming and past sessions, with RSVP counts.</summary>
    [Function("GetGroupSessions")]
    public async Task<IActionResult> GetGroupSessions(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groups/{groupId:guid}/sessions")] HttpRequest req,
        Guid groupId)
    {
        // Anonymous, unauthenticated route: never trust a caller-supplied userId. Signed-in
        // callers get the RSVP-aware view from the Private app's GetGroupSessions instead.
        var userId = Guid.Empty;

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
}
