using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions.Users.UsernameAvailable.ByUsername;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/users/username-available/{username} — true if the slug is free.</summary>
    [Function("CheckUsernameAvailable")]
    public async Task<IActionResult> CheckUsernameAvailable(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/username-available/{username}")] HttpRequest req,
        string username)
    {
        var normalized = username.Trim().ToLowerInvariant();
        if (!UsernameSlug.ValidFormat.IsMatch(normalized))
        {
            return new OkObjectResult(new UsernameAvailabilityDto(normalized, false, "invalid-format"));
        }

        var taken = await db.Users.AsNoTracking().Where(u => u.Username == normalized).CosmosAnyAsync();
        return new OkObjectResult(new UsernameAvailabilityDto(normalized, !taken, taken ? "taken" : null));
    }
}
