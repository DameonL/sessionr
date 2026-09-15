using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions;

/// <summary>
/// Finds the sets an edit makes stale at the edge, and purges them.
///
/// A set's cached payload carries each tune's title, key and ABC, not just a reference to it — so a
/// tune being renamed, re-keyed, re-set or deleted leaves every set holding it stale, and the set
/// itself was never written. The purge service has no database, so the "which sets contain this
/// tune" queries live here, stitched by id like the rest of the Cosmos code.
/// </summary>
public static class SetCachePurge
{
    /// <summary>Purges the personal sets that any of these repertoire tunes appear in.</summary>
    public static async Task PurgeSetsForUserTunesAsync(
        AppDbContext db,
        ICloudflareCachePurgeService purgeService,
        IEnumerable<Guid> userTuneIds)
    {
        var ids = userTuneIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return;
        }

        var setIds = await db.SetItems
            .AsNoTracking()
            .Where(si => ids.Contains(si.UserTuneId))
            .Select(si => si.SetId)
            .ToListAsync();

        if (setIds.Count > 0)
        {
            await purgeService.PurgeSetsAsync(setIds);

            // The public per-user list repeats each set's tune titles and keys, so an edit that
            // stales the sets stales their owners' profile lists with them.
            var ownerIds = await db.Sets
                .AsNoTracking()
                .Where(s => setIds.Contains(s.SetId))
                .Select(s => s.UserId)
                .ToListAsync();
            await PurgeUserSetListsAsync(db, purgeService, ownerIds);
        }
    }

    /// <summary>
    /// Purges the public profile set lists of these users, resolving the username slug each list is
    /// keyed on. Users without a slug have no public list, so they drop out silently.
    /// </summary>
    public static async Task PurgeUserSetListsAsync(
        AppDbContext db,
        ICloudflareCachePurgeService purgeService,
        IEnumerable<Guid> userIds)
    {
        var ids = userIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return;
        }

        var usernames = await db.Users
            .AsNoTracking()
            .Where(u => ids.Contains(u.UserId) && u.Username != null)
            .Select(u => u.Username!)
            .ToListAsync();

        if (usernames.Count > 0)
        {
            await purgeService.PurgeUserSetsAsync(usernames);
        }

        // The profile carries SetCount, so a set appearing or disappearing stales it too.
        await UserCachePurge.PurgeProfilesAsync(db, purgeService, ids);
    }

    /// <summary>Purges the group's set lists that hold this group tune, along with the group's index of them.</summary>
    public static async Task PurgeGroupSetsForGroupTuneAsync(
        AppDbContext db,
        ICloudflareCachePurgeService purgeService,
        Guid groupId,
        Guid groupTuneId)
    {
        var groupSetIds = await db.GroupSetItems
            .AsNoTracking()
            .Where(gsi => gsi.GroupTuneId == groupTuneId)
            .Select(gsi => gsi.GroupSetId)
            .ToListAsync();

        await purgeService.PurgeGroupSetsAsync(groupSetIds, groupId);
    }

    /// <summary>
    /// Purges every set that shows this tune, personal or group — for the moderator paths, where the
    /// master tune itself is edited or deleted and the copies of its title and ABC are spread across
    /// everyone's sets.
    /// </summary>
    public static async Task PurgeSetsContainingTuneAsync(
        AppDbContext db,
        ICloudflareCachePurgeService purgeService,
        Guid tuneId)
    {
        var userTuneIds = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.TuneId == tuneId)
            .Select(ut => ut.UserTuneId)
            .ToListAsync();
        await PurgeSetsForUserTunesAsync(db, purgeService, userTuneIds);

        var groupTunes = await db.GroupTunes
            .AsNoTracking()
            .Where(gt => gt.TuneId == tuneId)
            .Select(gt => new { gt.GroupTuneId, gt.GroupId })
            .ToListAsync();
        foreach (var groupTune in groupTunes)
        {
            await PurgeGroupSetsForGroupTuneAsync(db, purgeService, groupTune.GroupId, groupTune.GroupTuneId);
        }
    }

    /// <summary>
    /// Drops the set items that point at a group tune being removed, closing the numbering gaps it
    /// leaves behind, and returns the sets that changed so the caller can purge them.
    ///
    /// Cosmos has no cascade delete, and an orphaned item is worse than untidy: both group-set
    /// readers dereference the item's GroupTune, which the id stitch can no longer resolve, so the
    /// whole set 500s from the moment the tune leaves the group's list.
    /// </summary>
    public static async Task<IReadOnlyList<Guid>> RemoveGroupTuneFromSetsAsync(AppDbContext db, Guid groupTuneId)
    {
        var doomed = await db.GroupSetItems.Where(gsi => gsi.GroupTuneId == groupTuneId).ToListAsync();
        if (doomed.Count == 0)
        {
            return Array.Empty<Guid>();
        }

        var affectedSetIds = doomed.Select(i => i.GroupSetId).Distinct().ToList();
        db.GroupSetItems.RemoveRange(doomed);

        var doomedIds = doomed.Select(i => i.GroupSetItemId).ToHashSet();
        var survivors = await db.GroupSetItems
            .Where(gsi => affectedSetIds.Contains(gsi.GroupSetId))
            .ToListAsync();
        foreach (var set in survivors.Where(s => !doomedIds.Contains(s.GroupSetItemId)).GroupBy(s => s.GroupSetId))
        {
            var ordered = set.OrderBy(i => i.SequenceNumber).ToList();
            for (var i = 0; i < ordered.Count; i++)
            {
                ordered[i].SequenceNumber = i + 1;
            }
        }

        return affectedSetIds;
    }
}
