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

        var pending = await db.Friendships
            .AsNoTracking()
            .Where(f => f.Status == FriendshipStatus.Pending && f.ReceiverId == callerUserId.Value)
            .OrderByDescending(f => f.CreatedAt)
            .ToListAsync();

        // The requester is a separate User document — stitch by id.
        var requesterIds = pending.Select(f => f.RequesterId).Distinct().ToList();
        var requesters = await db.Users.AsNoTracking().Where(u => requesterIds.Contains(u.UserId)).ToDictionaryByIdAsync(u => u.UserId);

        var requests = pending.Select(f =>
        {
            var requester = requesters.GetValueOrDefault(f.RequesterId);
            return new FriendRequestDto(
                f.FriendshipId,
                f.RequesterId,
                requester?.DisplayName ?? "",
                requester?.Username,
                f.CreatedAt);
        }).ToList();

        return new OkObjectResult(requests);
    }
}
