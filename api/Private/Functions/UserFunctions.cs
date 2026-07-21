using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.GroupAuthorization;

namespace SessionApp.Api.Functions;

public class UserFunctions(AppDbContext db)
{
    public record UserLoginRequest(string Email, string DisplayName, string? Oid = null);
    public record UserLoginResponse(Guid UserId, string DisplayName, string Email);

    public record MigrateLegacyDataResponse(
        bool Migrated,
        string? LegacyEmail,
        int UserTunesMigrated,
        int SetsMigrated,
        int GroupMembershipsMigrated,
        int SessionRsvpsMigrated,
        int TuneSettingVotesMigrated,
        int GroupUpdatesMigrated,
        int GroupTunesMigrated,
        int GroupSessionsMigrated);

    /// <summary>
    /// POST /api/users/migrate-legacy-data — one-time helper for the MSAL identity switch.
    /// Finds a pre-existing Users row that shares the caller's own (server-verified) email
    /// but has a different UserId, and re-links its data to the caller's authentic UserId.
    /// Never accepts a target/email from the request body — both identities come from the
    /// caller's own authenticated session, so this can't be used to pull another user's data.
    /// Throwaway: delete this endpoint (and its frontend button) once used.
    /// </summary>
    [Function("MigrateLegacyData")]
    public async Task<IActionResult> MigrateLegacyData(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "users/migrate-legacy-data")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var targetUser = await db.Users.SingleAsync(u => u.UserId == callerUserId.Value);

        var legacyUser = await db.Users.SingleOrDefaultAsync(u => u.Email == targetUser.Email && u.UserId != callerUserId.Value);
        if (legacyUser is null)
        {
            return new OkObjectResult(new MigrateLegacyDataResponse(false, null, 0, 0, 0, 0, 0, 0, 0, 0));
        }

        var legacyUserId = legacyUser.UserId;
        var targetUserId = callerUserId.Value;

        // UserTunes carry a (UserId, TuneId) uniqueness constraint: if the target account
        // already holds a tune the legacy account also holds, drop the legacy duplicate
        // (cascades its practice log / ear-training progress) instead of reassigning it.
        var legacyUserTunes = await db.UserTunes.Where(ut => ut.UserId == legacyUserId).ToListAsync();
        var targetTuneIds = await db.UserTunes.Where(ut => ut.UserId == targetUserId).Select(ut => ut.TuneId).ToHashSetAsync();
        var userTunesMigrated = 0;
        foreach (var ut in legacyUserTunes)
        {
            if (targetTuneIds.Contains(ut.TuneId))
            {
                db.UserTunes.Remove(ut);
            }
            else
            {
                ut.UserId = targetUserId;
                userTunesMigrated++;
            }
        }

        var legacySets = await db.Sets.Where(s => s.UserId == legacyUserId).ToListAsync();
        foreach (var s in legacySets) s.UserId = targetUserId;

        // GroupMemberships: unique on (GroupId, UserId).
        var legacyMemberships = await db.GroupMemberships.Where(gm => gm.UserId == legacyUserId).ToListAsync();
        var targetGroupIds = await db.GroupMemberships.Where(gm => gm.UserId == targetUserId).Select(gm => gm.GroupId).ToHashSetAsync();
        var membershipsMigrated = 0;
        foreach (var gm in legacyMemberships)
        {
            if (targetGroupIds.Contains(gm.GroupId))
            {
                db.GroupMemberships.Remove(gm);
            }
            else
            {
                gm.UserId = targetUserId;
                membershipsMigrated++;
            }
        }

        // SessionRsvps: unique on (GroupSessionId, UserId).
        var legacyRsvps = await db.SessionRsvps.Where(r => r.UserId == legacyUserId).ToListAsync();
        var targetSessionIds = await db.SessionRsvps.Where(r => r.UserId == targetUserId).Select(r => r.GroupSessionId).ToHashSetAsync();
        var rsvpsMigrated = 0;
        foreach (var r in legacyRsvps)
        {
            if (targetSessionIds.Contains(r.GroupSessionId))
            {
                db.SessionRsvps.Remove(r);
            }
            else
            {
                r.UserId = targetUserId;
                rsvpsMigrated++;
            }
        }

        // TuneSettingVotes: unique on (TuneSettingId, UserId).
        var legacyVotes = await db.TuneSettingVotes.Where(v => v.UserId == legacyUserId).ToListAsync();
        var targetSettingIds = await db.TuneSettingVotes.Where(v => v.UserId == targetUserId).Select(v => v.TuneSettingId).ToHashSetAsync();
        var votesMigrated = 0;
        foreach (var v in legacyVotes)
        {
            if (targetSettingIds.Contains(v.TuneSettingId))
            {
                db.TuneSettingVotes.Remove(v);
            }
            else
            {
                v.UserId = targetUserId;
                votesMigrated++;
            }
        }

        // Attribution-only fields (no uniqueness tied to the user) can be reassigned outright.
        var legacyUpdates = await db.GroupUpdates.Where(gu => gu.CreatedByUserId == legacyUserId).ToListAsync();
        foreach (var gu in legacyUpdates) gu.CreatedByUserId = targetUserId;

        var legacyGroupTunes = await db.GroupTunes.Where(gt => gt.AddedByUserId == legacyUserId).ToListAsync();
        foreach (var gt in legacyGroupTunes) gt.AddedByUserId = targetUserId;

        var legacySessions = await db.GroupSessions.Where(gs => gs.CreatedByUserId == legacyUserId).ToListAsync();
        foreach (var gs in legacySessions) gs.CreatedByUserId = targetUserId;

        var legacyEmail = legacyUser.Email;
        db.Users.Remove(legacyUser);

        await db.SaveChangesAsync();

        return new OkObjectResult(new MigrateLegacyDataResponse(
            true,
            legacyEmail,
            userTunesMigrated,
            legacySets.Count,
            membershipsMigrated,
            rsvpsMigrated,
            votesMigrated,
            legacyUpdates.Count,
            legacyGroupTunes.Count,
            legacySessions.Count));
    }

    [Function("LoginOrRegisterUser")]
    public async Task<IActionResult> LoginOrRegisterUser(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "users/login")] HttpRequest req)
    {
        var body = await req.ReadFromJsonAsync<UserLoginRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Email))
        {
            return new BadRequestObjectResult("Email is required.");
        }

        var email = body.Email.Trim().ToLowerInvariant();
        var displayName = string.IsNullOrWhiteSpace(body.DisplayName) ? "New Musician" : body.DisplayName.Trim();

        Guid? parsedOid = Guid.TryParse(body.Oid, out var g) ? g : null;

        var user = await db.Users.SingleOrDefaultAsync(u =>
            (parsedOid.HasValue && u.UserId == parsedOid.Value) || u.Email == email);

        if (user is null)
        {
            // Self-service registration!
            user = new User
            {
                UserId = parsedOid ?? Guid.CreateVersion7(),
                Email = email,
                DisplayName = displayName
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
        }
        else
        {
            if (!string.IsNullOrWhiteSpace(displayName) && user.DisplayName != displayName)
            {
                user.DisplayName = displayName;
                await db.SaveChangesAsync();
            }
        }

        return new OkObjectResult(new UserLoginResponse(user.UserId, user.DisplayName, user.Email));
    }
}
