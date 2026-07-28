using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions;

/// <summary>
/// Authorization and identity resolution helpers for Azure Entra ID / EasyAuth Directory Groups and Claims.
/// 
/// Note: Azure Directory Groups (such as the Moderator group claim 83bbddaa-d861-4904-a932-371f5d33dfe8)
/// are used strictly for identity provider role authorization. They are completely distinct from in-app
/// SessionApp music bands and session groups (see SessionGroupAuthorization.cs).
/// </summary>
public static class AzureDirectoryAuthorization
{
    private const string DefaultModeratorGroupId = "83bbddaa-d861-4904-a932-371f5d33dfe8";

    /// <summary>Raw caller identity parsed from EasyAuth headers or a JWT Bearer token — no database access.</summary>
    public record CallerIdentity(Guid? UserId, string? Email, string? DisplayName);

    /// <summary>Cached copy of a user's profile fields, so warm GET /users/me requests can skip the DB entirely.</summary>
    public record CachedUserProfile(Guid UserId, string DisplayName, string? Username, string Email, string? Bio, string? Location, string? Instruments);

    /// <summary>Ensures a user record exists in db.Users for the given authenticated identity.</summary>
    public static async Task<Guid> EnsureUserExistsAsync(AppDbContext db, Guid userId, string? email = null, string? displayName = null)
    {
        var normalizedEmail = !string.IsNullOrWhiteSpace(email) ? email.Trim().ToLowerInvariant() : null;
        var trimmedDisplayName = !string.IsNullOrWhiteSpace(displayName) ? displayName.Trim() : null;

        var candidates = await db.Users
            .Where(u => u.UserId == userId || (normalizedEmail != null && u.Email == normalizedEmail))
            .ToListAsync();

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
                byOid.Email = normalizedEmail;
                changed = true;
            }

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

        // Silently claim a username slug derived from the display name when it's free.
        // On collision, leave Username null rather than auto-suffixing — the frontend
        // gates app entry on this and routes the user to pick one explicitly.
        var candidateUsername = UsernameSlug.Slugify(newUser.DisplayName);
        if (candidateUsername != null && !await db.Users.AnyAsync(u => u.Username == candidateUsername))
        {
            newUser.Username = candidateUsername;
        }

        db.Users.Add(newUser);
        try
        {
            await db.SaveChangesAsync();
            return newUser.UserId;
        }
        catch
        {
            // The AnyAsync pre-check above doesn't cover a concurrent signup claiming
            // the same slug in between the check and this save — retry once without
            // the username so user creation itself isn't blocked by that race.
            if (newUser.Username != null)
            {
                newUser.Username = null;
                try
                {
                    await db.SaveChangesAsync();
                    return newUser.UserId;
                }
                catch { /* fall through to reload below */ }
            }

            var reload = await db.Users.FirstOrDefaultAsync(u => u.UserId == userId || (normalizedEmail != null && u.Email == normalizedEmail));
            if (reload != null) return reload.UserId;
            throw;
        }
    }

    /// <summary>
    /// Extracts the authentic caller identity strictly from Azure EasyAuth headers and JWT Bearer tokens.
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

        // 3. Azure EasyAuth Direct Principal ID Header
        if (req.Headers.TryGetValue("X-MS-CLIENT-PRINCIPAL-ID", out var easyAuthIdValues) &&
            Guid.TryParse(easyAuthIdValues.ToString(), out var easyAuthGuid))
        {
            return new CallerIdentity(easyAuthGuid, null, null);
        }

        return new CallerIdentity(null, null, null);
    }

    private static readonly MemoryCache UserIdentityCache = new(new MemoryCacheOptions());
    private static readonly MemoryCacheEntryOptions CacheEntryOptions = new() { SlidingExpiration = TimeSpan.FromMinutes(10) };

    /// <summary>Looks up a cached profile for GET /users/me, avoiding a DB round trip on a warm cache.</summary>
    public static bool TryGetCachedProfile(Guid userId, out CachedUserProfile? profile)
    {
        return UserIdentityCache.TryGetValue($"user_profile_{userId}", out profile);
    }

    /// <summary>Caches (or refreshes) a user's profile fields, e.g. after a GET miss or a successful PATCH.</summary>
    public static void CacheProfile(CachedUserProfile profile)
    {
        UserIdentityCache.Set($"user_profile_{profile.UserId}", profile, CacheEntryOptions);
    }

    /// <summary>Resolves the caller identity and ensures a matching db.Users row exists.</summary>
    public static async Task<Guid?> GetCallerUserIdAsync(this HttpRequest req, AppDbContext db)
    {
        var identity = req.GetCallerIdentity();

        if (identity.UserId.HasValue)
        {
            var cacheKey = $"user_oid_{identity.UserId.Value}";
            if (UserIdentityCache.TryGetValue(cacheKey, out Guid cachedUserId))
            {
                return cachedUserId;
            }

            var userId = await EnsureUserExistsAsync(db, identity.UserId.Value, identity.Email, identity.DisplayName);
            UserIdentityCache.Set(cacheKey, userId, CacheEntryOptions);
            return userId;
        }

        if (!string.IsNullOrWhiteSpace(identity.Email))
        {
            var cacheKey = $"user_email_{identity.Email}";
            if (UserIdentityCache.TryGetValue(cacheKey, out Guid cachedUserId))
            {
                return cachedUserId;
            }

            var userByEmail = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == identity.Email);
            if (userByEmail != null)
            {
                UserIdentityCache.Set(cacheKey, userByEmail.UserId, CacheEntryOptions);
                return userByEmail.UserId;
            }

            var newUserId = await EnsureUserExistsAsync(db, Guid.CreateVersion7(), identity.Email, identity.DisplayName);
            UserIdentityCache.Set(cacheKey, newUserId, CacheEntryOptions);
            return newUserId;
        }

        return null;
    }

    /// <summary>
    /// Checks whether the request carries an Azure Entra Directory Group claim matching the specified target group Object ID.
    /// This parses claims from EasyAuth (X-MS-CLIENT-PRINCIPAL) or JWT Bearer tokens for authorization purposes.
    /// </summary>
    public static bool HasEntraGroupClaim(this HttpRequest req, string targetGroupId)
    {
        if (string.IsNullOrWhiteSpace(targetGroupId)) return false;

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

                        if (CheckGroupClaims(root, targetGroupId))
                        {
                            return true;
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
                    foreach (var claim in claimsArr.EnumerateArray())
                    {
                        var typ = claim.GetProperty("typ").GetString();
                        var val = claim.GetProperty("val").GetString();
                        if (typ == "groups" || typ == "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups" || typ == "wids" || typ == "roles")
                        {
                            if (string.Equals(val, targetGroupId, StringComparison.OrdinalIgnoreCase))
                            {
                                return true;
                            }
                        }
                    }
                }
            }
            catch { }
        }

        return false;
    }

    /// <summary>Checks whether the caller belongs to the Azure Moderator directory group via EasyAuth or JWT Bearer claims.</summary>
    public static bool IsCallerModerator(this HttpRequest req)
    {
        var targetGroupId = Environment.GetEnvironmentVariable("MODERATOR_GROUP_OBJECT_ID")?.Trim();
        if (string.IsNullOrEmpty(targetGroupId))
        {
            targetGroupId = DefaultModeratorGroupId;
        }

        return req.HasEntraGroupClaim(targetGroupId);
    }

    private static bool CheckGroupClaims(JsonElement root, string targetGroupId)
    {
        string[] groupClaimKeys = [
            "groups",
            "wids",
            "roles",
            "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
        ];

        foreach (var key in groupClaimKeys)
        {
            if (root.TryGetProperty(key, out var prop))
            {
                if (prop.ValueKind == JsonValueKind.Array)
                {
                    foreach (var elem in prop.EnumerateArray())
                    {
                        if (elem.ValueKind == JsonValueKind.String &&
                            string.Equals(elem.GetString(), targetGroupId, StringComparison.OrdinalIgnoreCase))
                        {
                            return true;
                        }
                    }
                }
                else if (prop.ValueKind == JsonValueKind.String)
                {
                    if (string.Equals(prop.GetString(), targetGroupId, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
            }
        }

        return false;
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

    /// <summary>Reads the client's local timezone offset in minutes from the X-Timezone-Offset header (defaults to 0 / UTC if missing or invalid).</summary>
    public static int GetTimezoneOffsetMinutes(this HttpRequest req)
    {
        if (req != null &&
            req.Headers.TryGetValue("X-Timezone-Offset", out var values) &&
            int.TryParse(values.FirstOrDefault(), out var offset))
        {
            return offset;
        }
        return 0;
    }
}
