using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;

namespace SessionApp.Api.Functions.Friends.ByTargetUserId;

public class Delete(AppDbContext db)
{
    /// <summary>DELETE /api/friends/{targetUserId} — unfriend / remove an established friendship.</summary>
    [Function("RemoveFriend")]
    public async Task<IActionResult> RemoveFriend(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "friends/{targetUserId:guid}")] HttpRequest req,
        Guid targetUserId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return new UnauthorizedResult();
        }

        var friendship = await db.Friendships
            .FirstOrDefaultAsync(f => (f.RequesterId == callerUserId.Value && f.ReceiverId == targetUserId) ||
                                       (f.RequesterId == targetUserId && f.ReceiverId == callerUserId.Value));

        if (friendship is null)
        {
            return new NotFoundObjectResult("Friendship not found.");
        }

        db.Friendships.Remove(friendship);
        await db.SaveChangesAsync();

        return new OkObjectResult(new FriendshipStatusDto("None", null));
    }
}
