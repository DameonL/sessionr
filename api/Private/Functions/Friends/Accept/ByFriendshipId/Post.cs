using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;

namespace SessionApp.Api.Functions.Friends.Accept.ByFriendshipId;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/friends/accept/{friendshipId} — accept an incoming friend request.</summary>
    [Function("AcceptFriendRequest")]
    public async Task<IActionResult> AcceptFriendRequest(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "friends/accept/{friendshipId:guid}")] HttpRequest req,
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
            return new BadRequestObjectResult("You can only accept friend requests sent to you.");
        }

        friendship.Status = FriendshipStatus.Accepted;
        friendship.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return new OkObjectResult(new FriendshipStatusDto("Accepted", friendship.FriendshipId));
    }
}
