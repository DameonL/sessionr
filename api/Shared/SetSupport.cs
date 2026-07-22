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
            .Select(i => (i.UserTune.Tune.Title, i.UserTune.Tune.TuneType, i.UserTune.Tune.Key, i.Repetitions))
            .ToList());

        return new
        {
            set.SetId,
            set.Title,
            Items = ordered.Select(i => new SetItemDto(
                i.UserTuneId, i.SequenceNumber, i.Repetitions, i.UserTune.Tune.Title,
                i.UserTune.Tune.TuneType.ToString(), i.UserTune.Tune.Key,
                i.UserTune.CustomAbcText ?? i.UserTune.Tune.MasterAbcText)).ToList(),
            Analysis = analysis,
        };
    }

    public static async Task<IActionResult> LoadedSetResultAsync(AppDbContext db, SetAnalyzer analyzer, Guid setId)
    {
        var set = await db.Sets
            .AsNoTracking()
            .Include(s => s.Items.OrderBy(i => i.SequenceNumber))
            .ThenInclude(i => i.UserTune)
            .ThenInclude(ut => ut.Tune)
            .SingleOrDefaultAsync(s => s.SetId == setId);

        return set is null ? new NotFoundResult() : new OkObjectResult(ToDto(set, analyzer));
    }
}
