using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;


namespace SessionApp.Api.Functions;

/// <summary>Shared group-set helpers used by both the public (view) and private (mutate) group-set endpoints.</summary>
public static class GroupSetSupport
{
    /// <summary>Builds a list-view summary DTO (no ABC) directly from a lightweight, SQL-projected shape,
    /// so the ABC/settings columns are never read off disk for a list request.</summary>
    public static GroupSetSummaryDto ToSummaryDto(
        Guid groupSetId,
        Guid groupId,
        string title,
        List<(Guid GroupTuneId, int SequenceNumber, int Repetitions, string Title, TuneType TuneType, string Key)> items,
        SetAnalyzer analyzer)
    {
        var analysis = analyzer.Analyze(items.Select(i => (i.Title, i.TuneType, i.Key, i.Repetitions)).ToList());

        return new GroupSetSummaryDto(
            groupSetId,
            groupId,
            title,
            items.Select(i => new GroupSetItemSummaryDto(i.GroupTuneId, i.SequenceNumber, i.Repetitions, i.Title, i.TuneType.ToString(), i.Key)).ToList(),
            analysis);
    }

    public static async Task<IActionResult?> EnsureCanViewAsync(AppDbContext db, Guid groupId, Guid userId)
    {
        var group = await db.Groups.AsNoTracking().SingleOrDefaultAsync(g => g.GroupId == groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }
        if (group.IsPrivate && !await db.IsActiveMemberAsync(groupId, userId))
        {
            return Forbidden("This is a private group.");
        }
        return null;
    }

    public static string EffectiveKey(GroupTune groupTune) => groupTune.TuneSetting?.Key ?? groupTune.Tune.Key;

    public static object ToDto(GroupSet groupSet, SetAnalyzer analyzer)
    {
        var ordered = groupSet.Items.OrderBy(i => i.SequenceNumber).ToList();
        var analysis = analyzer.Analyze(ordered
            .Select(i => (i.GroupTune.Tune.Title, i.GroupTune.Tune.TuneType, EffectiveKey(i.GroupTune), i.Repetitions))
            .ToList());

        return new
        {
            groupSet.GroupSetId,
            groupSet.GroupId,
            groupSet.Title,
            Items = ordered.Select(i => new GroupSetItemDto(
                i.GroupTuneId, i.SequenceNumber, i.Repetitions, i.GroupTune.Tune.Title,
                i.GroupTune.Tune.TuneType.ToString(), EffectiveKey(i.GroupTune),
                i.GroupTune.TuneSetting?.AbcText ?? i.GroupTune.Tune.MasterAbcText)).ToList(),
            Analysis = analysis,
        };
    }

    public static async Task<IActionResult> LoadedSetResultAsync(AppDbContext db, SetAnalyzer analyzer, Guid groupSetId, Guid userId)
    {
        var groupSet = await db.GroupSets.AsNoTracking().SingleOrDefaultAsync(gs => gs.GroupSetId == groupSetId);
        if (groupSet is null)
        {
            return new NotFoundResult();
        }

        var viewError = await EnsureCanViewAsync(db, groupSet.GroupId, userId);
        if (viewError is not null)
        {
            return viewError;
        }

        await PopulateItemsAsync(db, groupSet);
        return new OkObjectResult(ToDto(groupSet, analyzer));
    }

    /// <summary>
    /// Loads each group-set's items and their <c>GroupTune -&gt; Tune/TuneSetting</c> chain by id-based
    /// stitching, assigning the in-memory navigation properties (ordered by sequence) so
    /// <see cref="ToDto"/> works without cross-document Includes.
    /// </summary>
    public static async Task PopulateItemsAsync(AppDbContext db, params GroupSet[] groupSets)
    {
        if (groupSets.Length == 0)
        {
            return;
        }

        var groupSetIds = groupSets.Select(gs => gs.GroupSetId).ToList();
        var items = await db.GroupSetItems.AsNoTracking().Where(i => groupSetIds.Contains(i.GroupSetId)).ToListAsync();

        var groupTuneIds = items.Select(i => i.GroupTuneId).Distinct().ToList();
        var groupTunes = await db.GroupTunes.AsNoTracking().Where(gt => groupTuneIds.Contains(gt.GroupTuneId)).ToListAsync();
        await PopulateTuneAndSettingAsync(db, groupTunes);

        var groupTuneById = groupTunes.ToDictionary(gt => gt.GroupTuneId);
        foreach (var item in items)
        {
            if (groupTuneById.TryGetValue(item.GroupTuneId, out var groupTune))
            {
                item.GroupTune = groupTune;
            }
        }

        var itemsBySet = items.ToLookup(i => i.GroupSetId);
        foreach (var groupSet in groupSets)
        {
            groupSet.Items = itemsBySet[groupSet.GroupSetId].OrderBy(i => i.SequenceNumber).ToList();
        }
    }

    /// <summary>Assigns each GroupTune's <c>Tune</c> and (optional) <c>TuneSetting</c> navigation by id-based stitch.</summary>
    public static async Task PopulateTuneAndSettingAsync(AppDbContext db, IReadOnlyList<GroupTune> groupTunes)
    {
        if (groupTunes.Count == 0)
        {
            return;
        }

        var tuneIds = groupTunes.Select(gt => gt.TuneId).Distinct().ToList();
        var tunes = await db.Tunes.AsNoTracking().Where(t => tuneIds.Contains(t.TuneId)).ToDictionaryByIdAsync(t => t.TuneId);

        var settingIds = groupTunes.Where(gt => gt.TuneSettingId.HasValue).Select(gt => gt.TuneSettingId!.Value).Distinct().ToList();
        var settings = settingIds.Count == 0
            ? new Dictionary<Guid, TuneSetting>()
            : await db.TuneSettings.AsNoTracking().Where(s => settingIds.Contains(s.TuneSettingId)).ToDictionaryByIdAsync(s => s.TuneSettingId);

        foreach (var groupTune in groupTunes)
        {
            if (tunes.TryGetValue(groupTune.TuneId, out var tune))
            {
                groupTune.Tune = tune;
            }
            groupTune.TuneSetting = groupTune.TuneSettingId.HasValue && settings.TryGetValue(groupTune.TuneSettingId.Value, out var setting)
                ? setting
                : null;
        }
    }
}
