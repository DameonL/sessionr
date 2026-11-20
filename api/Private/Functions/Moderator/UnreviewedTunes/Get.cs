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

    /// <summary>GET /api/moderator/unreviewed-tunes — fetch paged tunes pending moderator review.</summary>
    [Function("GetUnreviewedTunes")]
    public async Task<IActionResult> GetUnreviewedTunes(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "moderator/unreviewed-tunes")] HttpRequest req)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        int.TryParse(req.Query["page"], out var page);
        if (page < 1) page = 1;

        int.TryParse(req.Query["pageSize"], out var pageSize);
        if (pageSize < 1) pageSize = 25;
        if (pageSize > 100) pageSize = 100;

        var query = db.Tunes
            .AsNoTracking()
            .Where(t => !t.IsReviewed);

        var totalCount = await query.Select(t => t.TuneId).CosmosCountAsync();

        var tunes = await query
            .OrderByDescending(t => t.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(t => new ModeratorTuneDto(t.TuneId, t.Title, t.TuneType.ToString(), t.Key, t.MasterAbcText, t.IsReviewed, t.ReviewedAt, t.ReviewedBy, t.CreatedAt))
            .ToListAsync();

        var hasMore = (page * pageSize) < totalCount;
        return new OkObjectResult(new PagedResult<ModeratorTuneDto>(tunes, totalCount, page, pageSize, hasMore));
    }
}
