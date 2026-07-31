using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;

namespace SessionApp.Api.Functions.Friends.Cancel.ByFriendshipId;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/friends/cancel/{friendshipId} — cancel an outgoing friend request.</summary>
    [Function("CancelFriendRequest")]
    public async Task<IActionResult> CancelFriendRequest(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "friends/cancel/{friendshipId:guid}")] HttpRequest req,
        Guid friendshipId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return new UnauthorizedResult();
        }

        var friendship = await db.Friendships.FirstOrDefaultAsync(f => f.FriendshipId == friendshipId);
        if (friendship is null)
        {
            return new NotFoundObjectResult("Friend request not found.");
        }

        if (friendship.RequesterId != callerUserId.Value)
        {
            return new BadRequestObjectResult("You can only cancel friend requests sent by you.");
        }

        db.Friendships.Remove(friendship);
        await db.SaveChangesAsync();

        return new OkObjectResult(new FriendshipStatusDto("None", null));
    }
}
