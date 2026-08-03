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

namespace SessionApp.Api.Functions.Friends;

public class Get(AppDbContext db)
{
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

        var friendships = await db.Friendships
            .AsNoTracking()
            .Where(f => f.Status == FriendshipStatus.Accepted &&
                       (f.RequesterId == callerUserId.Value || f.ReceiverId == callerUserId.Value))
            .ToListAsync();

        // The friend (the other side of each row) is a separate User document — stitch by id.
        var friendIds = friendships
            .Select(f => f.RequesterId == callerUserId.Value ? f.ReceiverId : f.RequesterId)
            .Distinct()
            .ToList();
        var friendUsers = await db.Users
            .AsNoTracking()
            .Where(u => friendIds.Contains(u.UserId))
            .ToDictionaryByIdAsync(u => u.UserId);

        var friends = friendships
            .Select(f => new { Friendship = f, FriendId = f.RequesterId == callerUserId.Value ? f.ReceiverId : f.RequesterId })
            .Where(x => friendUsers.ContainsKey(x.FriendId))
            .Select(x => new { x.Friendship, FriendUser = friendUsers[x.FriendId] })
            .OrderBy(x => x.FriendUser.DisplayName)
            .Select(x => new FriendDto(
                x.FriendUser.UserId,
                x.FriendUser.DisplayName,
                x.FriendUser.Username,
                x.FriendUser.Bio,
                x.FriendUser.Location,
                x.FriendUser.Instruments,
                x.Friendship.UpdatedAt))
            .ToList();

        return new OkObjectResult(friends);
    }
}
