using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions.Users.ByUsername.Profile;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/users/by-username/{username}/profile — a user's public profile fields, resolved by slug.</summary>
    [Function("GetPublicUserProfileByUsername")]
    public async Task<IActionResult> GetPublicUserProfileByUsername(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/by-username/{username}/profile")] HttpRequest req,
        string username)
    {
        var normalized = username.Trim().ToLowerInvariant();
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Username == normalized);
        if (user is null)
        {
            return new NotFoundResult();
        }

        return new OkObjectResult(new PublicUserProfileDto(user.UserId, user.DisplayName, user.Username, user.Bio, user.Location, user.Instruments));
    }
}
