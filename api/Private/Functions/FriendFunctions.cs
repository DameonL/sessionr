using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;

namespace SessionApp.Api.Functions;

public class FriendFunctions(AppDbContext db)
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

        var targetUserExists = await db.Users.AsNoTracking().AnyAsync(u => u.UserId == targetUserId);
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
            // If the target user had already requested the caller, automatically accept it!
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

    /// <summary>GET /api/friends — retrieve the caller's list of accepted friends.</summary>
    [Function("GetFriendsList")]
    public async Task<IActionResult> GetFriendsList(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "friends")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return new UnauthorizedResult();
        }

        var friends = await db.Friendships
            .AsNoTracking()
            .Where(f => f.Status == FriendshipStatus.Accepted &&
                       (f.RequesterId == callerUserId.Value || f.ReceiverId == callerUserId.Value))
            .Include(f => f.Requester)
            .Include(f => f.Receiver)
            .Select(f => new {
                Friendship = f,
                FriendUser = f.RequesterId == callerUserId.Value ? f.Receiver : f.Requester
            })
            .OrderBy(x => x.FriendUser.DisplayName)
            .Select(x => new FriendDto(
                x.FriendUser.UserId,
                x.FriendUser.DisplayName,
                x.FriendUser.Username,
                x.FriendUser.Bio,
                x.FriendUser.Location,
                x.FriendUser.Instruments,
                x.Friendship.UpdatedAt))
            .ToListAsync();

        return new OkObjectResult(friends);
    }

    /// <summary>GET /api/friends/requests — retrieve pending incoming friend requests for the caller.</summary>
    [Function("GetPendingFriendRequests")]
    public async Task<IActionResult> GetPendingFriendRequests(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "friends/requests")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return new UnauthorizedResult();
        }

        var requests = await db.Friendships
            .AsNoTracking()
            .Where(f => f.Status == FriendshipStatus.Pending && f.ReceiverId == callerUserId.Value)
            .Include(f => f.Requester)
            .OrderByDescending(f => f.CreatedAt)
            .Select(f => new FriendRequestDto(
                f.FriendshipId,
                f.RequesterId,
                f.Requester.DisplayName,
                f.Requester.Username,
                f.CreatedAt))
            .ToListAsync();

        return new OkObjectResult(requests);
    }
}
