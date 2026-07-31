using System;
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

namespace SessionApp.Api.Functions.Users.Me;

public class Patch(AppDbContext db)
{
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

        CacheProfile(new CachedUserProfile(user.UserId, user.DisplayName, user.Username, user.Email, user.Bio, user.Location, user.Instruments));

        var isModerator = req.IsCallerModerator();
        return new OkObjectResult(new Get.UserLoginResponse(user.UserId, user.DisplayName, user.Username, user.Email, user.Bio, user.Location, user.Instruments, isModerator));
    }
}
