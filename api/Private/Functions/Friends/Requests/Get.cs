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

namespace SessionApp.Api.Functions.Friends.Requests;

public class Get(AppDbContext db)
{
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
