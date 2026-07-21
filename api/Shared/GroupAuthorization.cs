using System;
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

    /// <summary>Extracts authentic caller User ID strictly from Azure EasyAuth headers and credentials.</summary>
    public static async Task<Guid?> GetCallerUserIdAsync(this HttpRequest req, AppDbContext db)
    {
        // 1. Azure EasyAuth Direct Principal ID Header
        if (req.Headers.TryGetValue("X-MS-CLIENT-PRINCIPAL-ID", out var easyAuthIdValues) &&
            Guid.TryParse(easyAuthIdValues.ToString(), out var easyAuthGuid))
        {
            return easyAuthGuid;
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
                        if ((typ == "http://schemas.microsoft.com/identity/claims/objectidentifier" || typ == "oid" || typ == "sub") &&
                            Guid.TryParse(val, out var claimGuid))
                        {
                            return claimGuid;
                        }
                    }
                }
            }
            catch { }
        }

        // 3. Authorization Header (Bearer token / EasyAuth MSAL JWT)
        if (req.Headers.TryGetValue("Authorization", out var authHeaderValues))
        {
            var authHeader = authHeaderValues.ToString().Trim();
            if (authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                var token = authHeader.Substring(7).Trim();
                if (Guid.TryParse(token, out var bearerGuid))
                {
                    return bearerGuid;
                }

                // Decode MSAL ID token / Access token payload
                var parts = token.Split('.');
                if (parts.Length == 3)
                {
                    try
                    {
                        var payloadJson = Encoding.UTF8.GetString(Base64UrlDecode(parts[1]));
                        using var doc = JsonDocument.Parse(payloadJson);
                        var root = doc.RootElement;

                        string? oidStr = null;
                        if (root.TryGetProperty("oid", out var oidProp)) oidStr = oidProp.GetString();
                        else if (root.TryGetProperty("sub", out var subProp)) oidStr = subProp.GetString();

                        if (Guid.TryParse(oidStr, out var oidGuid))
                        {
                            return oidGuid;
                        }

                        // Lookup by email claim
                        string? emailStr = null;
                        if (root.TryGetProperty("email", out var emailProp)) emailStr = emailProp.GetString();
                        else if (root.TryGetProperty("preferred_username", out var prefProp)) emailStr = prefProp.GetString();

                        if (!string.IsNullOrWhiteSpace(emailStr))
                        {
                            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Email == emailStr);
                            if (user != null) return user.UserId;
                        }
                    }
                    catch { }
                }
            }
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
