using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Users.Me;

public class Get(AppDbContext db)
{
    public record UserLoginResponse(Guid UserId, string DisplayName, string? Username, string Email, string? Bio, string? Location, string? Instruments, bool IsModerator, bool IsProfilePrivate);

    /// <summary>GET /api/users/me — resolves (and lazily provisions) the caller's own user record.</summary>
    [Function("GetCurrentUser")]
    public async Task<IActionResult> GetCurrentUser(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/me")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var isModerator = req.IsCallerModerator();

        if (TryGetCachedProfile(callerUserId.Value, out var cached) && cached is not null)
        {
            return new OkObjectResult(new UserLoginResponse(cached.UserId, cached.DisplayName, cached.Username, cached.Email, cached.Bio, cached.Location, cached.Instruments, isModerator, cached.IsProfilePrivate));
        }

        var user = await db.Users.AsNoTracking().SingleAsync(u => u.UserId == callerUserId.Value);
        CacheProfile(new CachedUserProfile(user.UserId, user.DisplayName, user.Username, user.Email, user.Bio, user.Location, user.Instruments, user.IsProfilePrivate));
        return new OkObjectResult(new UserLoginResponse(user.UserId, user.DisplayName, user.Username, user.Email, user.Bio, user.Location, user.Instruments, isModerator, user.IsProfilePrivate));
    }
}
