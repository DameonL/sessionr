using System;
using System.Security.Cryptography;
using System.Threading.Tasks;
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
