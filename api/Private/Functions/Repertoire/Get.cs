using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Repertoire;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/repertoire — the user's tunes with effective ABC.</summary>
    [Function("GetRepertoire")]
    public async Task<IActionResult> GetRepertoire(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "repertoire")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var search = req.Query["search"].ToString();
        var type = req.Query["type"].ToString();
        var status = req.Query["status"].ToString();
        var summary = bool.TryParse(req.Query["summary"], out var summaryFlag) && summaryFlag;

        int.TryParse(req.Query["page"], out var page);
        if (page < 1) page = 1;

        int.TryParse(req.Query["pageSize"], out var pageSize);
        if (pageSize < 1) pageSize = 20;
        if (pageSize > 100) pageSize = 100;

        // Status lives on the UserTune document, so it filters server-side; search/type/order all
        // depend on the referenced Tune (a separate Cosmos document), so we project only lightweight
        // metadata to filter/sort/page before hydrating full ABCs for the single requested page.
        IQueryable<UserTune> query = db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == callerUserId.Value);

        if (Enum.TryParse<TuneStatus>(status, ignoreCase: true, out var tuneStatus))
        {
            query = query.Where(ut => ut.Status == tuneStatus);
        }

        var rawUserTunes = await query
            .Select(ut => new
            {
                ut.UserTuneId,
                ut.TuneId,
                ut.TuneSettingId,
                ut.Status,
                ut.LastPracticed,
                ut.TargetBpm,
            })
            .ToListAsync();

        if (rawUserTunes.Count == 0)
        {
            return summary
                ? new OkObjectResult(new PagedResult<RepertoireListItemDto>([], 0, page, pageSize, false))
                : new OkObjectResult(new PagedResult<RepertoireItemDto>([], 0, page, pageSize, false));
        }

        var tuneIds = rawUserTunes.Select(ut => ut.TuneId).Distinct().ToList();
        var tuneMeta = new Dictionary<Guid, (string Title, TuneType TuneType, string Key, int Difficulty)>(tuneIds.Count);
        foreach (var chunk in tuneIds.Chunk(100))
        {
            var chunkIds = chunk.ToList();
            var batch = await db.Tunes
                .AsNoTracking()
                .Where(t => chunkIds.Contains(t.TuneId))
                .Select(t => new
                {
                    t.TuneId,
                    t.Title,
                    t.TuneType,
                    t.Key,
                    Difficulty = (int?)t.Difficulty,
                })
                .ToListAsync();
            foreach (var t in batch)
            {
                tuneMeta[t.TuneId] = (t.Title ?? string.Empty, t.TuneType, t.Key ?? string.Empty, t.Difficulty ?? 0);
            }
        }

        var enriched = rawUserTunes
            .Select(ut =>
            {
                var meta = tuneMeta.TryGetValue(ut.TuneId, out var m)
                    ? m
                    : (Title: string.Empty, TuneType: TuneType.Other, Key: string.Empty, Difficulty: 0);
                return (UserTune: ut, Meta: meta);
            });

        if (!string.IsNullOrWhiteSpace(search))
        {
            enriched = enriched.Where(x => x.Meta.Title.Contains(search, StringComparison.OrdinalIgnoreCase));
        }
        if (Enum.TryParse<TuneType>(type, ignoreCase: true, out var tuneType))
        {
            enriched = enriched.Where(x => x.Meta.TuneType == tuneType);
        }

        var ordered = enriched.ByTitle(x => x.Meta.Title).ToList();

        var totalCount = ordered.Count;
        var hasMore = (page * pageSize) < totalCount;
        var pageEntries = ordered.Skip((page - 1) * pageSize).Take(pageSize).ToList();

        if (summary)
        {
            // The list view deliberately skips ResolveUnpinnedSettingsAsync and ABC columns: it only
            // reads Key for any explicitly pinned settings on the current page.
            var pinnedSettingIds = pageEntries
                .Where(x => x.UserTune.TuneSettingId.HasValue)
                .Select(x => x.UserTune.TuneSettingId!.Value)
                .Distinct()
                .ToList();
            var settingKeys = pinnedSettingIds.Count == 0
                ? new Dictionary<Guid, string>()
                : await db.TuneSettings
                    .AsNoTracking()
                    .Where(s => pinnedSettingIds.Contains(s.TuneSettingId))
                    .ToDictionaryAsync(s => s.TuneSettingId, s => s.Key);

            var listItems = pageEntries
                .Select(x =>
                {
                    var ut = x.UserTune;
                    var key = ut.TuneSettingId.HasValue && settingKeys.TryGetValue(ut.TuneSettingId.Value, out var sk)
                        ? sk
                        : x.Meta.Key;
                    return new RepertoireListItemDto(
                        ut.UserTuneId,
                        ut.TuneId,
                        x.Meta.Title,
                        x.Meta.TuneType.ToString(),
                        key,
                        ut.Status.ToString(),
                        ut.LastPracticed,
                        ut.TargetBpm,
                        x.Meta.Difficulty);
                })
                .ToList();

            return new OkObjectResult(new PagedResult<RepertoireListItemDto>(listItems, totalCount, page, pageSize, hasMore));
        }

        var pageIds = pageEntries.Select(x => x.UserTune.UserTuneId).ToList();
        var pageUserTunes = pageIds.Count == 0
            ? []
            : await db.UserTunes
                .AsNoTracking()
                .Where(ut => pageIds.Contains(ut.UserTuneId))
                .ToListAsync();

        await SetSupport.PopulateTuneAndSettingAsync(db, pageUserTunes);
        await RepertoireSupport.ResolveUnpinnedSettingsAsync(db, pageUserTunes);

        var byId = pageUserTunes.ToDictionary(ut => ut.UserTuneId);
        var items = pageIds
            .Where(byId.ContainsKey)
            .Select(id => RepertoireSupport.ToItemDto(byId[id]))
            .ToList();

        return new OkObjectResult(new PagedResult<RepertoireItemDto>(items, totalCount, page, pageSize, hasMore));
    }
}
