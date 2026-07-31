using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Users.ByUserId;

[RequireModerator]
public class Get(AppDbContext db)
{
    public record ModeratorUserDetailsDto(Guid UserId, string DisplayName, string? Username, string Email, string? Bio, string? Location, string? Instruments, bool IsModerator, int GroupCount, int TuneCount);

    /// <summary>GET /api/moderator/users/{userId} — fetch full user details for moderator inspection.</summary>
    [Function("GetModeratorUserDetails")]
    public async Task<IActionResult> GetModeratorUserDetails(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "moderator/users/{userId:guid}")] HttpRequest req,
        Guid userId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.UserId == userId);
        if (user is null)
        {
            return new NotFoundResult();
        }

        var groupCount = await db.GroupMemberships.CountAsync(gm => gm.UserId == userId);
        var tuneCount = await db.UserTunes.CountAsync(ut => ut.UserId == userId);

        return new OkObjectResult(new ModeratorUserDetailsDto(
            user.UserId,
            user.DisplayName,
            user.Username,
            user.Email,
            user.Bio,
            user.Location,
            user.Instruments,
            false,
            groupCount,
            tuneCount
        ));
    }
}
