using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;

namespace SessionApp.Api.Functions.Friends.Request.ByTargetUserId;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/friends/request/{targetUserId} — send a friend request.</summary>
    [Function("SendFriendRequest")]
    public async Task<IActionResult> SendFriendRequest(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "friends/request/{targetUserId:guid}")] HttpRequest req,
        Guid targetUserId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return new UnauthorizedResult();
        }

        if (callerUserId.Value == targetUserId)
        {
            return new BadRequestObjectResult("You cannot send a friend request to yourself.");
        }

        var targetUserExists = await db.Users.AsNoTracking().Where(u => u.UserId == targetUserId).CosmosAnyAsync();
        if (!targetUserExists)
        {
            return new NotFoundObjectResult("Target user not found.");
        }

        var existing = await db.Friendships
            .FirstOrDefaultAsync(f => (f.RequesterId == callerUserId.Value && f.ReceiverId == targetUserId) ||
                                       (f.RequesterId == targetUserId && f.ReceiverId == callerUserId.Value));

        if (existing is not null)
        {
            if (existing.Status == FriendshipStatus.Accepted)
            {
                return new ConflictObjectResult("You are already friends with this user.");
            }
            if (existing.RequesterId == callerUserId.Value)
            {
                return new ConflictObjectResult("Friend request is already pending.");
            }
            existing.Status = FriendshipStatus.Accepted;
            existing.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync();
            return new OkObjectResult(new FriendshipStatusDto("Accepted", existing.FriendshipId));
        }

        var newFriendship = new Friendship
        {
            RequesterId = callerUserId.Value,
            ReceiverId = targetUserId,
            Status = FriendshipStatus.Pending,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        db.Friendships.Add(newFriendship);
        await db.SaveChangesAsync();

        return new OkObjectResult(new FriendshipStatusDto("PendingSent", newFriendship.FriendshipId));
    }
}
