using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.GroupAuthorization;

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
        var groupSet = await db.GroupSets
            .AsNoTracking()
            .Include(gs => gs.Items.OrderBy(i => i.SequenceNumber))
            .ThenInclude(i => i.GroupTune).ThenInclude(gt => gt.Tune)
            .Include(gs => gs.Items)
            .ThenInclude(i => i.GroupTune).ThenInclude(gt => gt.TuneSetting)
            .SingleOrDefaultAsync(gs => gs.GroupSetId == groupSetId);

        if (groupSet is null)
        {
            return new NotFoundResult();
        }

        var viewError = await EnsureCanViewAsync(db, groupSet.GroupId, userId);
        if (viewError is not null)
        {
            return viewError;
        }

        return new OkObjectResult(ToDto(groupSet, analyzer));
    }
}
