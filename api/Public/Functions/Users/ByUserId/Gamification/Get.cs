using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;

namespace SessionApp.Api.Functions.Users.ByUserId.Gamification;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/users/{userId}/gamification — a user's public points total and earned badges.</summary>
    [Function("GetPublicGamificationSummary")]
    public async Task<IActionResult> GetPublicGamificationSummary(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/{userId:guid}/gamification")] HttpRequest req,
        Guid userId)
    {
        // Keyed on the user id rather than the slug, so this needs its own privacy check.
        if (!await ProfileVisibility.IsPubliclyVisibleAsync(db, userId))
        {
            return new NotFoundResult();
        }

        return new OkObjectResult(await GamificationSupport.BuildSummaryAsync(db, userId));
    }
}
