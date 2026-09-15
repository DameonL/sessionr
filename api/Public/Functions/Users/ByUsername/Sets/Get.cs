using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions.Users.ByUsername.Sets;

public class Get(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>
    /// GET /api/users/by-username/{username}/sets — a user's sets, for their public profile.
    ///
    /// Sets follow profile privacy: the username slug is the whole gate, so a user with no public
    /// profile to resolve has no public set list either.
    /// </summary>
    [Function("GetPublicUserSetsByUsername")]
    public async Task<IActionResult> GetPublicUserSetsByUsername(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/by-username/{username}/sets")] HttpRequest req,
        string username)
    {
        var normalized = username.Trim().ToLowerInvariant();
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Username == normalized);
        if (user is null)
        {
            return new NotFoundResult();
        }

        var rawSets = await db.Sets
            .AsNoTracking()
            .Where(s => s.UserId == user.UserId)
            .ToListAsync();

        await SetSupport.PopulateItemsAsync(db, rawSets.ToArray());

        // Sorted here rather than in the query: Cosmos cannot translate the article-stripping key.
        var sets = rawSets
            .ByTitle(s => s.Title)
            .Select(s => SetSupport.ToSummaryDto(
                s.SetId,
                s.Title,
                s.Items.Select(i => (
                    i.UserTuneId,
                    i.SequenceNumber,
                    i.Repetitions,
                    i.UserTune.Tune.Title,
                    i.UserTune.Tune.TuneType,
                    i.UserTune.TuneSetting != null ? i.UserTune.TuneSetting.Key : i.UserTune.Tune.Key)).ToList(),
                analyzer))
            .ToList();

        return new OkObjectResult(sets);
    }
}
