using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;

namespace SessionApp.Api.Functions.Friends.Status.ByTargetUserId;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/friends/status/{targetUserId} — check friendship relationship with target user.</summary>
    [Function("GetFriendshipStatus")]
    public async Task<IActionResult> GetFriendshipStatus(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "friends/status/{targetUserId:guid}")] HttpRequest req,
        Guid targetUserId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return new UnauthorizedResult();
        }

        if (callerUserId.Value == targetUserId)
        {
            return new OkObjectResult(new FriendshipStatusDto("Self", null));
        }

        var friendship = await db.Friendships
            .AsNoTracking()
            .FirstOrDefaultAsync(f => (f.RequesterId == callerUserId.Value && f.ReceiverId == targetUserId) ||
                                       (f.RequesterId == targetUserId && f.ReceiverId == callerUserId.Value));

        if (friendship is null)
        {
            return new OkObjectResult(new FriendshipStatusDto("None", null));
        }

        if (friendship.Status == FriendshipStatus.Accepted)
        {
            return new OkObjectResult(new FriendshipStatusDto("Accepted", friendship.FriendshipId));
        }

        if (friendship.RequesterId == callerUserId.Value)
        {
            return new OkObjectResult(new FriendshipStatusDto("PendingSent", friendship.FriendshipId));
        }

        return new OkObjectResult(new FriendshipStatusDto("PendingReceived", friendship.FriendshipId));
    }
}
