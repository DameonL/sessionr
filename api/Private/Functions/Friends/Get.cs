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
}
