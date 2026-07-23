using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;

namespace SessionApp.Api.Functions;

/// <summary>Read-only access to a musician's public profile — no ownership check, no email exposed.</summary>
public class PublicUserFunctions(AppDbContext db)
{
    /// <summary>GET /api/users/{userId}/profile — a user's public profile fields.</summary>
    [Function("GetPublicUserProfile")]
    public async Task<IActionResult> GetPublicUserProfile(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/{userId:guid}/profile")] HttpRequest req,
        Guid userId)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.UserId == userId);
        if (user is null)
        {
            return new NotFoundResult();
        }

        return new OkObjectResult(new PublicUserProfileDto(user.UserId, user.DisplayName, user.Bio, user.Location, user.Instruments));
    }

    /// <summary>GET /api/users/{userId}/gamification — a user's public points total and earned badges.</summary>
    [Function("GetPublicGamificationSummary")]
    public async Task<IActionResult> GetPublicGamificationSummary(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/{userId:guid}/gamification")] HttpRequest req,
        Guid userId)
    {
        var exists = await db.Users.AsNoTracking().AnyAsync(u => u.UserId == userId);
        if (!exists)
        {
            return new NotFoundResult();
        }

        return new OkObjectResult(await GamificationSupport.BuildSummaryAsync(db, userId));
    }
}
