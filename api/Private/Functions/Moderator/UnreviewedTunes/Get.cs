using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.UnreviewedTunes;

[RequireModerator]
public class Get(AppDbContext db)
{
    public record ModeratorTuneDto(Guid TuneId, string Title, string TuneType, string Key, string MasterAbcText, bool IsReviewed, DateTime? ReviewedAt, string? ReviewedBy, DateTime CreatedAt);

    /// <summary>GET /api/moderator/unreviewed-tunes — fetch all tunes pending moderator review.</summary>
    [Function("GetUnreviewedTunes")]
    public async Task<IActionResult> GetUnreviewedTunes(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "moderator/unreviewed-tunes")] HttpRequest req)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var tunes = await db.Tunes
            .AsNoTracking()
            .Where(t => !t.IsReviewed)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new ModeratorTuneDto(t.TuneId, t.Title, t.TuneType.ToString(), t.Key, t.MasterAbcText, t.IsReviewed, t.ReviewedAt, t.ReviewedBy, t.CreatedAt))
            .ToListAsync();

        return new OkObjectResult(tunes);
    }
}
