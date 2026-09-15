using System;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

/// <summary>
/// Resolves whether a user's public profile surface is visible, for the anonymous reads that hang
/// off it.
///
/// The privacy check is deliberately applied **in memory, after materialization**, rather than
/// folded into the query as <c>!u.IsProfilePrivate</c>. User documents written before the property
/// existed simply do not carry it, and Cosmos propagates undefined rather than coercing it: server
/// side, <c>NOT c["IsProfilePrivate"]</c> over a missing property evaluates to undefined, not true,
/// so the document fails the filter and every pre-existing user reads as private — the exact
/// deploy-day outcome the flag's negative polarity exists to prevent. Materializing first puts the
/// decision in C#, where EF has already supplied the CLR default <c>false</c> for the missing
/// property and "absent" correctly means "public".
/// </summary>
public static class ProfileVisibility
{
    /// <summary>The user behind a public profile slug, or null if the slug is unknown or private.</summary>
    public static async Task<User?> FindPublicBySlugAsync(AppDbContext db, string normalizedUsername)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Username == normalizedUsername);
        return user is not null && !user.IsProfilePrivate ? user : null;
    }

    /// <summary>True when this user exists and has not hidden their profile.</summary>
    public static async Task<bool> IsPubliclyVisibleAsync(AppDbContext db, Guid userId)
    {
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.UserId == userId);
        return user is not null && !user.IsProfilePrivate;
    }
}
