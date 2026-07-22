using System;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

/// <summary>Shared group-role lookup and permission helpers for the group-scoped Functions files.</summary>
public static class GroupAuthorization
{
    // Excludes visually ambiguous characters (0/O, 1/I).
    private const string InviteCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    /// <summary>Ensures a user record exists in db.Users for the given authenticated identity.</summary>
    public static async Task<Guid> EnsureUserExistsAsync(AppDbContext db, Guid userId, string? email = null, string? displayName = null)
    {
        var normalizedEmail = !string.IsNullOrWhiteSpace(email) ? email.Trim().ToLowerInvariant() : null;
        var trimmedDisplayName = !string.IsNullOrWhiteSpace(displayName) ? displayName.Trim() : null;

        var candidates = await db.Users
            .Where(u => u.UserId == userId || (normalizedEmail != null && u.Email == normalizedEmail))
            .ToListAsync();

        // The oid is the durable IdP identity anchor (stable across email changes), so prefer
        // it deterministically over an email match when the two point at different rows.
        var byOid = candidates.FirstOrDefault(u => u.UserId == userId);
        var byEmail = normalizedEmail != null ? candidates.FirstOrDefault(u => u.Email == normalizedEmail) : null;

        if (byOid != null)
        {
            var changed = false;

            if (byEmail != null && byEmail.UserId != byOid.UserId)
            {
                Console.Error.WriteLine(
                    $"EnsureUserExistsAsync: identity ambiguity — oid {userId} -> user {byOid.UserId}, " +
                    $"email {normalizedEmail} -> different user {byEmail.UserId}. Using the oid match.");
            }
            else if (normalizedEmail != null && byOid.Email != normalizedEmail)
            {
                // No other row owns this email, so it's safe to heal a stale/placeholder
                // email (e.g. from a login that once resolved via an oid-only source).
                byOid.Email = normalizedEmail;
                changed = true;
            }

            // DisplayName is seeded from the JWT only once, at row creation below — after
            // that it's user-owned (editable via the profile page) and never re-synced from
            // the identity provider, even if the account's real name changes later.

            if (changed)
            {
                await db.SaveChangesAsync();
            }
            return byOid.UserId;
        }

        if (byEmail != null)
        {
            return byEmail.UserId;
        }

        var newUser = new User
        {
            UserId = userId,
            Email = normalizedEmail ?? $"{userId:N}@auth.sessionr",
            DisplayName = trimmedDisplayName ?? "Musician"
        };

        db.Users.Add(newUser);
        try
        {
            await db.SaveChangesAsync();
            return newUser.UserId;
        }
        catch
        {
            // Fallback for concurrency: reload
            var reload = await db.Users.FirstOrDefaultAsync(u => u.UserId == userId || (normalizedEmail != null && u.Email == normalizedEmail));
            if (reload != null) return reload.UserId;
            throw;
        }
    }

    /// <summary>Raw caller identity parsed from EasyAuth headers or a JWT Bearer token — no database access.</summary>
    public record CallerIdentity(Guid? UserId, string? Email, string? DisplayName);

    /// <summary>
    /// Extracts the authentic caller identity strictly from Azure EasyAuth headers and JWT Bearer
    /// tokens. Tries the Authorization Bearer token first — the frontend always sends it, it's the
    /// exact token EasyAuth itself already validated to let the request through, and it carries the
    /// full claim set (email/name). EasyAuth's own injected headers are checked only as a fallback:
    /// X-MS-CLIENT-PRINCIPAL-ID in particular carries the oid alone with no email or name, so trying
    /// it first (as this used to) would silently starve every downstream call of real profile data.
    /// </summary>
    public static CallerIdentity GetCallerIdentity(this HttpRequest req)
    {
        // 1. Authorization Header (JWT Bearer Token)
        if (req.Headers.TryGetValue("Authorization", out var authHeaderValues))
        {
            var authHeader = authHeaderValues.ToString().Trim();
            if (authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                var token = authHeader.Substring(7).Trim();
                var parts = token.Split('.');
                if (parts.Length == 3)
                {
                    try
                    {
                        var payloadJson = Encoding.UTF8.GetString(Base64UrlDecode(parts[1]));
                        using var doc = JsonDocument.Parse(payloadJson);
                        var root = doc.RootElement;

                        if (root.TryGetProperty("exp", out var expProp))
                        {
                            long expSeconds = 0;
                            if (expProp.ValueKind == JsonValueKind.Number) expSeconds = expProp.GetInt64();
                            else if (expProp.ValueKind == JsonValueKind.String && long.TryParse(expProp.GetString(), out var sExp)) expSeconds = sExp;

                            if (expSeconds > 0)
                            {
                                var nowSeconds = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                                if (nowSeconds >= expSeconds)
                                {
                                    return new CallerIdentity(null, null, null);
                                }
                            }
                        }

                        string? oidStr = null;
                        if (root.TryGetProperty("oid", out var oidProp)) oidStr = oidProp.GetString();
                        else if (root.TryGetProperty("sub", out var subProp)) oidStr = subProp.GetString();

                        string? emailStr = null;
                        if (root.TryGetProperty("email", out var emailProp)) emailStr = emailProp.GetString();
                        else if (root.TryGetProperty("preferred_username", out var prefProp)) emailStr = prefProp.GetString();

                        string? nameStr = null;
                        if (root.TryGetProperty("name", out var nameProp)) nameStr = nameProp.GetString();

                        if (Guid.TryParse(oidStr, out var oidGuid))
                        {
                            return new CallerIdentity(oidGuid, emailStr, nameStr);
                        }

                        if (!string.IsNullOrWhiteSpace(emailStr))
                        {
                            return new CallerIdentity(null, emailStr, nameStr);
                        }
                    }
                    catch { }
                }
            }
        }

        // 2. Azure EasyAuth Encoded Principal Header (Base64-encoded Claims)
        if (req.Headers.TryGetValue("X-MS-CLIENT-PRINCIPAL", out var principalHeaderValues))
        {
            try
            {
                var json = Encoding.UTF8.GetString(Convert.FromBase64String(principalHeaderValues.ToString()));
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (root.TryGetProperty("claims", out var claimsArr) && claimsArr.ValueKind == JsonValueKind.Array)
                {
                    string? oidStr = null;
                    string? emailStr = null;
                    string? nameStr = null;

                    foreach (var claim in claimsArr.EnumerateArray())
                    {
                        var typ = claim.GetProperty("typ").GetString();
                        var val = claim.GetProperty("val").GetString();
                        if (typ == "http://schemas.microsoft.com/identity/claims/objectidentifier" || typ == "oid" || typ == "sub")
                        {
                            oidStr = val;
                        }
                        else if (typ == "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress" || typ == "email" || typ == "preferred_username")
                        {
                            emailStr = val;
                        }
                        else if (typ == "name" || typ == "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name")
                        {
                            nameStr = val;
                        }
                    }

                    if (Guid.TryParse(oidStr, out var claimGuid))
                    {
                        return new CallerIdentity(claimGuid, emailStr, nameStr);
                    }

                    if (!string.IsNullOrWhiteSpace(emailStr))
                    {
                        return new CallerIdentity(null, emailStr, nameStr);
                    }
                }
            }
            catch { }
        }

        // 3. Azure EasyAuth Direct Principal ID Header — oid only, no email/name. Last resort.
        if (req.Headers.TryGetValue("X-MS-CLIENT-PRINCIPAL-ID", out var easyAuthIdValues) &&
            Guid.TryParse(easyAuthIdValues.ToString(), out var easyAuthGuid))
        {
            return new CallerIdentity(easyAuthGuid, null, null);
        }

        return new CallerIdentity(null, null, null);
    }

    /// <summary>Resolves the caller identity and ensures a matching db.Users row exists.</summary>
    public static async Task<Guid?> GetCallerUserIdAsync(this HttpRequest req, AppDbContext db)
    {
        var identity = req.GetCallerIdentity();

        if (identity.UserId.HasValue)
        {
            return await EnsureUserExistsAsync(db, identity.UserId.Value, identity.Email, identity.DisplayName);
        }

        if (!string.IsNullOrWhiteSpace(identity.Email))
        {
            var userByEmail = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == identity.Email);
            if (userByEmail != null) return userByEmail.UserId;
            return await EnsureUserExistsAsync(db, Guid.CreateVersion7(), identity.Email, identity.DisplayName);
        }

        return null;
    }

    private static byte[] Base64UrlDecode(string input)
    {
        var output = input.Replace('-', '+').Replace('_', '/');
        switch (output.Length % 4)
        {
            case 2: output += "=="; break;
            case 3: output += "="; break;
        }
        return Convert.FromBase64String(output);
    }

    /// <summary>The caller's role, or null if they aren't an active member (pending requests have no permissions).</summary>
    public static async Task<GroupRole?> GetRoleAsync(this AppDbContext db, Guid groupId, Guid userId)
    {
        var membership = await db.GroupMemberships
            .AsNoTracking()
            .SingleOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == userId && gm.Status == GroupMembershipStatus.Active);
        return membership?.Role;
    }

    public static Task<bool> IsActiveMemberAsync(this AppDbContext db, Guid groupId, Guid userId) =>
        db.GroupMemberships.AsNoTracking()
            .AnyAsync(gm => gm.GroupId == groupId && gm.UserId == userId && gm.Status == GroupMembershipStatus.Active);

    public static bool IsAdminOrOwner(this GroupRole? role) => role is GroupRole.Administrator or GroupRole.Owner;

    public static bool IsAdminOrOwner(this GroupRole role) => role is GroupRole.Administrator or GroupRole.Owner;

    public static ObjectResult Forbidden(string message) => new(message) { StatusCode = 403 };

    public static ObjectResult Unauthorized(string message) => new(message) { StatusCode = 401 };

    public static string GenerateInviteCode()
    {
        var bytes = RandomNumberGenerator.GetBytes(8);
        Span<char> chars = stackalloc char[8];
        for (var i = 0; i < chars.Length; i++)
        {
            chars[i] = InviteCodeAlphabet[bytes[i] % InviteCodeAlphabet.Length];
        }
        return new string(chars);
    }
}
