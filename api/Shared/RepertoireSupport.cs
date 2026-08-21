using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

/// <summary>
/// Shared resolution and projection for a user's repertoire entries. A <see cref="UserTune"/> may
/// pin a specific <see cref="TuneSetting"/>; when it doesn't, the entry follows the community
/// default (the tune's highest-voted setting). Both cases funnel through here so every repertoire
/// endpoint reports the same effective key and ABC.
/// </summary>
public static class RepertoireSupport
{
    /// <summary>
    /// Fills <see cref="UserTune.TuneSetting"/> for entries that have no pin (or whose pinned
    /// setting has since been deleted) from the tune's highest-voted setting, so an unpinned entry
    /// renders what the tune page shows rather than the raw master ABC. Call *after*
    /// <see cref="SetSupport.PopulateTuneAndSettingAsync"/>, which resolves the pinned ones.
    /// Costs one extra TuneSettings query, and only when something is actually unresolved — list
    /// views that don't need ABC should skip it.
    /// </summary>
    public static async Task ResolveUnpinnedSettingsAsync(AppDbContext db, IReadOnlyList<UserTune> userTunes)
    {
        var unresolvedTuneIds = userTunes
            .Where(ut => ut.TuneSetting is null)
            .Select(ut => ut.TuneId)
            .Distinct()
            .ToList();

        if (unresolvedTuneIds.Count == 0)
        {
            return;
        }

        var candidates = await db.TuneSettings
            .AsNoTracking()
            .Where(s => unresolvedTuneIds.Contains(s.TuneId))
            .ToListAsync();

        // Ordering happens in memory: Cosmos can't order by a column it isn't indexed on across
        // partitions, and the candidate set is one tune's settings, so it is tiny either way.
        var topByTuneId = candidates
            .GroupBy(s => s.TuneId)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(s => s.VoteScore).ThenBy(s => s.TuneSettingId).First());

        foreach (var userTune in userTunes)
        {
            if (userTune.TuneSetting is null && topByTuneId.TryGetValue(userTune.TuneId, out var setting))
            {
                userTune.TuneSetting = setting;
            }
        }
    }

    /// <summary>
    /// The single repertoire-item projection. Effective ABC precedence matches
    /// <see cref="SetSupport.ToDto"/> and the practice queue:
    /// <c>CustomAbcText ?? TuneSetting.AbcText ?? Tune.MasterAbcText</c>.
    /// <c>IsPinnedSetting</c> distinguishes a setting the user chose from one resolved by votes.
    /// </summary>
    public static RepertoireItemDto ToItemDto(UserTune ut)
    {
        var setting = ut.TuneSetting;

        return new RepertoireItemDto(
            ut.UserTuneId,
            ut.TuneId,
            ut.Tune.Title,
            ut.Tune.TuneType.ToString(),
            setting?.Key ?? ut.Tune.Key,
            ut.Status.ToString(),
            ut.LastPracticed,
            ut.TargetBpm,
            ut.CustomAbcText ?? setting?.AbcText ?? ut.Tune.MasterAbcText,
            ut.CustomAbcText != null,
            ut.Tune.Difficulty,
            ut.Tune.StartingMidi,
            ut.Tune.EndingMidi,
            setting?.TuneSettingId,
            setting?.SubmitterName,
            ut.TuneSettingId.HasValue && setting != null && ut.TuneSettingId == setting.TuneSettingId);
    }
}
