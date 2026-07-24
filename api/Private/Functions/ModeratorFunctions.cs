using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;


namespace SessionApp.Api.Functions;

[RequireModerator]
public class ModeratorFunctions(AppDbContext db)

{
    public record ModeratorTuneDto(Guid TuneId, string Title, string TuneType, string Key, string MasterAbcText, bool IsReviewed, DateTime? ReviewedAt, string? ReviewedBy, DateTime CreatedAt);
    public record ModeratorGroupDto(Guid GroupId, string Name, string Description, string? City, bool IsPrivate, string? InviteCode, bool IsReviewed, DateTime? ReviewedAt, string? ReviewedBy, DateTime CreatedAt, int MemberCount);
    public record UpdateMasterTuneRequest(string Title, string TuneType, string Key, string MasterAbcText);
    public record SanitizeProfileRequest(string? DisplayName, string? Bio, string? Location, string? Instruments);
    public record ModeratorUserDetailsDto(Guid UserId, string DisplayName, string? Username, string Email, string? Bio, string? Location, string? Instruments, bool IsModerator, int GroupCount, int TuneCount);

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

    /// <summary>GET /api/moderator/unreviewed-groups — fetch all groups pending moderator review.</summary>
    [Function("GetUnreviewedGroups")]
    public async Task<IActionResult> GetUnreviewedGroups(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "moderator/unreviewed-groups")] HttpRequest req)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var groups = await db.Groups
            .AsNoTracking()
            .Where(g => !g.IsReviewed)
            .OrderByDescending(g => g.CreatedAt)
            .Select(g => new ModeratorGroupDto(g.GroupId, g.Name, g.Description, g.City, g.IsPrivate, g.InviteCode, g.IsReviewed, g.ReviewedAt, g.ReviewedBy, g.CreatedAt, g.Memberships.Count))
            .ToListAsync();

        return new OkObjectResult(groups);
    }

    /// <summary>POST /api/moderator/tunes/{tuneId}/approve — mark a tune as reviewed and approved.</summary>
    [Function("ApproveTune")]
    public async Task<IActionResult> ApproveTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "moderator/tunes/{tuneId:guid}/approve")] HttpRequest req,
        Guid tuneId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var tune = await db.Tunes.SingleOrDefaultAsync(t => t.TuneId == tuneId);
        if (tune is null)
        {
            return new NotFoundResult();
        }

        var caller = req.GetCallerIdentity();
        tune.IsReviewed = true;
        tune.ReviewedAt = DateTime.UtcNow;
        tune.ReviewedBy = caller.Email ?? caller.DisplayName ?? caller.UserId?.ToString() ?? "Moderator";

        await db.SaveChangesAsync();
        return new OkObjectResult(new ModeratorTuneDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key, tune.MasterAbcText, tune.IsReviewed, tune.ReviewedAt, tune.ReviewedBy, tune.CreatedAt));
    }

    /// <summary>POST /api/moderator/groups/{groupId}/approve — mark a group as reviewed and approved.</summary>
    [Function("ApproveGroup")]
    public async Task<IActionResult> ApproveGroup(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "moderator/groups/{groupId:guid}/approve")] HttpRequest req,
        Guid groupId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var group = await db.Groups.Include(g => g.Memberships).SingleOrDefaultAsync(g => g.GroupId == groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        var caller = req.GetCallerIdentity();
        group.IsReviewed = true;
        group.ReviewedAt = DateTime.UtcNow;
        group.ReviewedBy = caller.Email ?? caller.DisplayName ?? caller.UserId?.ToString() ?? "Moderator";

        await db.SaveChangesAsync();
        return new OkObjectResult(new ModeratorGroupDto(group.GroupId, group.Name, group.Description, group.City, group.IsPrivate, group.InviteCode, group.IsReviewed, group.ReviewedAt, group.ReviewedBy, group.CreatedAt, group.Memberships.Count));
    }

    /// <summary>PUT /api/moderator/tunes/{tuneId} — edit master tune details.</summary>
    [Function("ModeratorUpdateTune")]
    public async Task<IActionResult> ModeratorUpdateTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "moderator/tunes/{tuneId:guid}")] HttpRequest req,
        Guid tuneId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var body = await req.ReadFromJsonAsync<UpdateMasterTuneRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Title) || string.IsNullOrWhiteSpace(body.MasterAbcText))
        {
            return new BadRequestObjectResult("Title and MasterAbcText are required.");
        }

        var tune = await db.Tunes.SingleOrDefaultAsync(t => t.TuneId == tuneId);
        if (tune is null)
        {
            return new NotFoundResult();
        }

        if (!Enum.TryParse<TuneType>(body.TuneType, ignoreCase: true, out var tuneType))
        {
            tuneType = TuneType.Other;
        }

        tune.Title = body.Title.Trim();
        tune.TuneType = tuneType;
        tune.Key = body.Key.Trim();
        tune.MasterAbcText = body.MasterAbcText;

        await db.SaveChangesAsync();
        return new OkObjectResult(new ModeratorTuneDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key, tune.MasterAbcText, tune.IsReviewed, tune.ReviewedAt, tune.ReviewedBy, tune.CreatedAt));
    }

    /// <summary>DELETE /api/moderator/tunes/{tuneId} — delete a tune permanently.</summary>
    [Function("ModeratorDeleteTune")]
    public async Task<IActionResult> ModeratorDeleteTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "moderator/tunes/{tuneId:guid}")] HttpRequest req,
        Guid tuneId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var tune = await db.Tunes.SingleOrDefaultAsync(t => t.TuneId == tuneId);
        if (tune is null)
        {
            return new NotFoundResult();
        }

        db.Tunes.Remove(tune);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }

    /// <summary>DELETE /api/moderator/tunes/settings/{settingId} — delete a tune setting.</summary>
    [Function("ModeratorDeleteTuneSetting")]
    public async Task<IActionResult> ModeratorDeleteTuneSetting(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "moderator/tunes/settings/{settingId:guid}")] HttpRequest req,
        Guid settingId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var setting = await db.TuneSettings.SingleOrDefaultAsync(s => s.TuneSettingId == settingId);
        if (setting is null)
        {
            return new NotFoundResult();
        }

        db.TuneSettings.Remove(setting);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }

    /// <summary>DELETE /api/moderator/tunes/aliases/{aliasId} — delete a tune alias.</summary>
    [Function("ModeratorDeleteTuneAlias")]
    public async Task<IActionResult> ModeratorDeleteTuneAlias(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "moderator/tunes/aliases/{aliasId:guid}")] HttpRequest req,
        Guid aliasId)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var alias = await db.TuneAliases.SingleOrDefaultAsync(a => a.TuneAliasId == aliasId);
        if (alias is null)
        {
            return new NotFoundResult();
        }

        db.TuneAliases.Remove(alias);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }

    /// <summary>GET /api/moderator/groups — fetch all groups (public and private).</summary>
    [Function("GetModeratorGroups")]
    public async Task<IActionResult> GetModeratorGroups(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "moderator/groups")] HttpRequest req)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        var groups = await db.Groups
            .AsNoTracking()
            .OrderByDescending(g => g.CreatedAt)
            .Select(g => new ModeratorGroupDto(g.GroupId, g.Name, g.Description, g.City, g.IsPrivate, g.InviteCode, g.IsReviewed, g.ReviewedAt, g.ReviewedBy, g.CreatedAt, g.Memberships.Count))
            .ToListAsync();

        return new OkObjectResult(groups);
    }

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
        return new OkObjectResult(new { success = true, user.UserId, user.DisplayName });
    }
}
