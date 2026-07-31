using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions.Users.ByUserId.ActiveTunes;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/users/{userId}/active-tunes — the tunes a user currently has at Active status, for their public profile.</summary>
    [Function("GetPublicActiveTunes")]
    public async Task<IActionResult> GetPublicActiveTunes(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/{userId:guid}/active-tunes")] HttpRequest req,
        Guid userId)
    {
        var exists = await db.Users.AsNoTracking().AnyAsync(u => u.UserId == userId);
        if (!exists)
        {
            return new NotFoundResult();
        }

        var tunes = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == userId && ut.Status == TuneStatus.Active)
            .Include(ut => ut.Tune)
            .Include(ut => ut.TuneSetting)
            .OrderBy(ut => ut.Tune.Title.StartsWith("The ") ? ut.Tune.Title.Substring(4)
                : ut.Tune.Title.StartsWith("A ") ? ut.Tune.Title.Substring(2)
                : ut.Tune.Title)
            .Select(ut => new PublicActiveTuneDto(
                ut.TuneId,
                ut.Tune.Title,
                ut.Tune.TuneType.ToString(),
                ut.TuneSetting != null ? ut.TuneSetting.Key : ut.Tune.Key))
            .ToListAsync();

        return new OkObjectResult(tunes);
    }
}
