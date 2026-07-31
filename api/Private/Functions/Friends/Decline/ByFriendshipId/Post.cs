using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;

namespace SessionApp.Api.Functions.Friends.Decline.ByFriendshipId;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/friends/decline/{friendshipId} — decline an incoming friend request.</summary>
    [Function("DeclineFriendRequest")]
    public async Task<IActionResult> DeclineFriendRequest(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "friends/decline/{friendshipId:guid}")] HttpRequest req,
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

        if (friendship.ReceiverId != callerUserId.Value)
        {
            return new BadRequestObjectResult("You can only decline friend requests sent to you.");
        }

        db.Friendships.Remove(friendship);
        await db.SaveChangesAsync();

        return new OkObjectResult(new FriendshipStatusDto("None", null));
    }
}
