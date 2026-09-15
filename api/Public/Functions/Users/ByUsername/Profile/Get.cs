using System.Linq;
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

        // Counted by projecting to ids: CosmosCountAsync materializes whatever the query selects,
        // and the point of carrying these here is to spare the caller the full lists.
        var activeTuneCount = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == user.UserId && ut.Status == TuneStatus.Active)
            .Select(ut => ut.UserTuneId)
            .CosmosCountAsync();

        var setCount = await db.Sets
            .AsNoTracking()
            .Where(s => s.UserId == user.UserId)
            .Select(s => s.SetId)
            .CosmosCountAsync();

        return new OkObjectResult(new PublicUserProfileDto(
            user.UserId, user.DisplayName, user.Username, user.Bio, user.Location, user.Instruments,
            activeTuneCount, setCount));
    }
}
