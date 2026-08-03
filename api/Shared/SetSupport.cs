using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions;

/// <summary>Shared DTO projection used by both the public (view) and private (mutate) personal-set endpoints.</summary>
public static class SetSupport
{
    /// <summary>Builds a list-view summary DTO (no ABC) directly from a lightweight, SQL-projected shape,
    /// so the ABC/settings columns are never read off disk for a list request.</summary>
    public static SetSummaryDto ToSummaryDto(
        Guid setId,
        string title,
        List<(Guid UserTuneId, int SequenceNumber, int Repetitions, string Title, TuneType TuneType, string Key)> items,
        SetAnalyzer analyzer)
    {
        var analysis = analyzer.Analyze(items.Select(i => (i.Title, i.TuneType, i.Key, i.Repetitions)).ToList());

        return new SetSummaryDto(
            setId,
            title,
            items.Select(i => new SetItemSummaryDto(i.UserTuneId, i.SequenceNumber, i.Repetitions, i.Title, i.TuneType.ToString(), i.Key)).ToList(),
            analysis);
    }

    public static object ToDto(Set set, SetAnalyzer analyzer)
    {
        var ordered = set.Items.OrderBy(i => i.SequenceNumber).ToList();
        var analysis = analyzer.Analyze(ordered
            .Select(i => (
                i.UserTune.Tune.Title,
                i.UserTune.Tune.TuneType,
                i.UserTune.TuneSetting?.Key ?? i.UserTune.Tune.Key,
                i.Repetitions))
            .ToList());

        return new
        {
            set.SetId,
            set.Title,
            Items = ordered.Select(i => new SetItemDto(
                i.UserTuneId,
                i.SequenceNumber,
                i.Repetitions,
                i.UserTune.Tune.Title,
                i.UserTune.Tune.TuneType.ToString(),
                i.UserTune.TuneSetting?.Key ?? i.UserTune.Tune.Key,
                i.UserTune.CustomAbcText ?? (i.UserTune.TuneSetting != null ? i.UserTune.TuneSetting.AbcText : i.UserTune.Tune.MasterAbcText)
            )).ToList(),
            Analysis = analysis,
        };
    }

    public static async Task<IActionResult> LoadedSetResultAsync(AppDbContext db, SetAnalyzer analyzer, Guid setId)
    {
        var set = await db.Sets.AsNoTracking().SingleOrDefaultAsync(s => s.SetId == setId);
        if (set is null)
        {
            return new NotFoundResult();
        }

        await PopulateItemsAsync(db, set);
        return new OkObjectResult(ToDto(set, analyzer));
    }

    /// <summary>
    /// Loads each set's items and their <c>UserTune -&gt; Tune/TuneSetting</c> chain by id-based
    /// stitching, then assigns the in-memory navigation properties (ordered by sequence) so
    /// <see cref="ToDto"/> works without cross-document Includes. Replaces the old nested Include chain.
    /// </summary>
    public static async Task PopulateItemsAsync(AppDbContext db, params Set[] sets)
    {
        if (sets.Length == 0)
        {
            return;
        }

        var setIds = sets.Select(s => s.SetId).ToList();
        var items = await db.SetItems.AsNoTracking().Where(si => setIds.Contains(si.SetId)).ToListAsync();

        var userTuneIds = items.Select(i => i.UserTuneId).Distinct().ToList();
        var userTunes = await db.UserTunes.AsNoTracking().Where(ut => userTuneIds.Contains(ut.UserTuneId)).ToListAsync();
        await PopulateTuneAndSettingAsync(db, userTunes);

        var userTuneById = userTunes.ToDictionary(ut => ut.UserTuneId);
        foreach (var item in items)
        {
            if (userTuneById.TryGetValue(item.UserTuneId, out var userTune))
            {
                item.UserTune = userTune;
            }
        }

        var itemsBySet = items.ToLookup(i => i.SetId);
        foreach (var set in sets)
        {
            set.Items = itemsBySet[set.SetId].OrderBy(i => i.SequenceNumber).ToList();
        }
    }

    /// <summary>
    /// Assigns each UserTune's <c>Tune</c> and (optional) <c>TuneSetting</c> navigation by id-based
    /// stitch. Shared by the set, repertoire, practice-queue and suggestion paths, all of which need
    /// a UserTune with its tune metadata resolved without a cross-document Include.
    /// </summary>
    public static async Task PopulateTuneAndSettingAsync(AppDbContext db, IReadOnlyList<UserTune> userTunes)
    {
        if (userTunes.Count == 0)
        {
            return;
        }

        var tuneIds = userTunes.Select(ut => ut.TuneId).Distinct().ToList();
        var tunes = await db.Tunes.AsNoTracking().Where(t => tuneIds.Contains(t.TuneId)).ToDictionaryByIdAsync(t => t.TuneId);

        var settingIds = userTunes.Where(ut => ut.TuneSettingId.HasValue).Select(ut => ut.TuneSettingId!.Value).Distinct().ToList();
        var settings = settingIds.Count == 0
            ? new Dictionary<Guid, TuneSetting>()
            : await db.TuneSettings.AsNoTracking().Where(s => settingIds.Contains(s.TuneSettingId)).ToDictionaryByIdAsync(s => s.TuneSettingId);

        foreach (var userTune in userTunes)
        {
            if (tunes.TryGetValue(userTune.TuneId, out var tune))
            {
                userTune.Tune = tune;
            }
            userTune.TuneSetting = userTune.TuneSettingId.HasValue && settings.TryGetValue(userTune.TuneSettingId.Value, out var setting)
                ? setting
                : null;
        }
    }
}
