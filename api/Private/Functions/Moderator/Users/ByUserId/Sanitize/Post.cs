using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Users.ByUserId.Sanitize;

[RequireModerator]
public class Post(AppDbContext db)
{
    public record SanitizeProfileRequest(string? DisplayName, string? Bio, string? Location, string? Instruments);

    /// <summary>POST /api/moderator/users/{userId}/sanitize — sanitize or clear offensive profile fields on a user.</summary>
    [Function("SanitizeUserProfile")]
    public async Task<IActionResult> SanitizeUserProfile(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "moderator/users/{userId:guid}/sanitize")] HttpRequest req,
        Guid userId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var body = await req.ReadFromJsonAsync<SanitizeProfileRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request payload is required.");
        }

        var user = await db.Users.SingleOrDefaultAsync(u => u.UserId == userId);
        if (user is null)
        {
            return new NotFoundResult();
        }

        if (body.DisplayName is not null) user.DisplayName = body.DisplayName.Trim();
        if (body.Bio is not null) user.Bio = string.IsNullOrWhiteSpace(body.Bio) ? null : body.Bio.Trim();
        if (body.Location is not null) user.Location = string.IsNullOrWhiteSpace(body.Location) ? null : body.Location.Trim();
        if (body.Instruments is not null) user.Instruments = string.IsNullOrWhiteSpace(body.Instruments) ? null : body.Instruments.Trim();

        await db.SaveChangesAsync();

        var groupCount = await db.GroupMemberships.Where(gm => gm.UserId == userId).Select(gm => gm.GroupMembershipId).CosmosCountAsync();
        var tuneCount = await db.UserTunes.Where(ut => ut.UserId == userId).Select(ut => ut.UserTuneId).CosmosCountAsync();

        return new OkObjectResult(new ByUserId.Get.ModeratorUserDetailsDto(
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
