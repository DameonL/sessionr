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

namespace SessionApp.Api.Functions.Groups.ByGroupId.Sessions;

public class Get(AppDbContext db)
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
}
