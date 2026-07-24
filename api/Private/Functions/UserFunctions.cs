using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;


namespace SessionApp.Api.Functions;

public class UserFunctions(AppDbContext db)
{
    public record UserLoginResponse(Guid UserId, string DisplayName, string? Username, string Email, string? Bio, string? Location, string? Instruments, bool IsModerator);

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
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.UserId == callerUserId.Value);
        return new OkObjectResult(new UserLoginResponse(user.UserId, user.DisplayName, user.Username, user.Email, user.Bio, user.Location, user.Instruments, isModerator));
    }


    /// <summary>PATCH /api/users/me — updates the caller's own profile fields. Null = leave unchanged.</summary>
    [Function("UpdateCurrentUser")]
    public async Task<IActionResult> UpdateCurrentUser(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "users/me")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<UpdateUserProfileRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request payload is required.");
        }

        var user = await db.Users.SingleAsync(u => u.UserId == callerUserId.Value);

        if (body.DisplayName is not null)
        {
            var trimmed = body.DisplayName.Trim();
            if (trimmed.Length == 0 || trimmed.Length > 100)
            {
                return new BadRequestObjectResult("DisplayName must be 1-100 characters.");
            }
            user.DisplayName = trimmed;
        }

        if (body.Bio is not null)
        {
            var trimmed = body.Bio.Trim();
            if (trimmed.Length > 2000)
            {
                return new BadRequestObjectResult("Bio must be 2000 characters or fewer.");
            }
            user.Bio = trimmed.Length == 0 ? null : trimmed;
        }

        if (body.Location is not null)
        {
            var trimmed = body.Location.Trim();
            if (trimmed.Length > 200)
            {
                return new BadRequestObjectResult("Location must be 200 characters or fewer.");
            }
            user.Location = trimmed.Length == 0 ? null : trimmed;
        }

        if (body.Instruments is not null)
        {
            var trimmed = body.Instruments.Trim();
            if (trimmed.Length > 400)
            {
                return new BadRequestObjectResult("Instruments must be 400 characters or fewer.");
            }
            user.Instruments = trimmed.Length == 0 ? null : trimmed;
        }

        if (body.Username is not null)
        {
            var trimmed = body.Username.Trim().ToLowerInvariant();
            if (!UsernameSlug.ValidFormat.IsMatch(trimmed))
            {
                return new BadRequestObjectResult("Username must be 3-30 characters, lowercase letters, numbers, and hyphens only.");
            }

            if (trimmed != user.Username)
            {
                var taken = await db.Users.AnyAsync(u => u.Username == trimmed && u.UserId != user.UserId);
                if (taken)
                {
                    return new ConflictObjectResult("That username is already taken.");
                }
                user.Username = trimmed;
            }
        }

        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return new ConflictObjectResult("That username was just taken — please choose another.");
        }

        var isModerator = req.IsCallerModerator();
        return new OkObjectResult(new UserLoginResponse(user.UserId, user.DisplayName, user.Username, user.Email, user.Bio, user.Location, user.Instruments, isModerator));
    }


    /// <summary>GET /api/users/me/gamification — the caller's own points total and earned badges.</summary>
    [Function("GetMyGamificationSummary")]
    public async Task<IActionResult> GetMyGamificationSummary(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/me/gamification")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        return new OkObjectResult(await GamificationSupport.BuildSummaryAsync(db, callerUserId.Value));
    }
}
