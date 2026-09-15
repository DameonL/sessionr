using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions;

/// <summary>
/// Finds the public user documents an edit makes stale at the edge, and purges them.
///
/// The profile is keyed on the username slug while its sibling reads are keyed on the user id, so a
/// purge needs both and the caller usually has only the id. The profile payload also carries the
/// active-tune and set counts, which means writes that never touch a profile field — adding a tune,
/// retiring one, building or deleting a set — still stale it.
/// </summary>
public static class UserCachePurge
{
    /// <summary>Purges a user's public profile document and the reads keyed alongside it.</summary>
    public static Task PurgeProfileAsync(AppDbContext db, ICloudflareCachePurgeService purgeService, Guid userId)
        => PurgeProfilesAsync(db, purgeService, new[] { userId });

    /// <summary>
    /// Purges the public profiles of these users. A user with no username slug has no public
    /// profile URL, so only their id-keyed reads are purged.
    /// </summary>
    public static async Task PurgeProfilesAsync(
        AppDbContext db,
        ICloudflareCachePurgeService purgeService,
        IEnumerable<Guid> userIds)
    {
        var ids = userIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return;
        }

        var users = await db.Users
            .AsNoTracking()
            .Where(u => ids.Contains(u.UserId))
            .Select(u => new { u.UserId, u.Username })
            .ToListAsync();

        foreach (var user in users)
        {
            await purgeService.PurgeUserProfileAsync(user.Username, user.UserId);
        }
    }
}
