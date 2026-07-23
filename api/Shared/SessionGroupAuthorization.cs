using System;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

/// <summary>
/// Authorization and role lookup helpers for SessionApp In-App Music Groups and Bands.
/// 
/// Note: These helpers deal strictly with the domain entity Group (bands, jam sessions, meeting schedules, setlists).
/// They are completely distinct from Azure Entra Directory Groups used for platform role authorization (see AzureDirectoryAuthorization.cs).
/// </summary>
public static class SessionGroupAuthorization
{
    private const string InviteCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    /// <summary>The caller's role in an in-app SessionApp music group, or null if they aren't an active member.</summary>
    public static async Task<GroupRole?> GetRoleAsync(this AppDbContext db, Guid groupId, Guid userId)
    {
        var membership = await db.GroupMemberships
            .AsNoTracking()
            .SingleOrDefaultAsync(gm => gm.GroupId == groupId && gm.UserId == userId && gm.Status == GroupMembershipStatus.Active);
        return membership?.Role;
    }

    /// <summary>Checks whether a user is an active member of an in-app SessionApp music group.</summary>
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
