using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Sessions.BySessionId;

public class Delete(AppDbContext db)
{
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
}
