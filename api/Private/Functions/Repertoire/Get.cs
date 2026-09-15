using System;
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
        // depend on the referenced Tune (a separate Cosmos document), so those run in memory after
        // stitching each UserTune's Tune/TuneSetting by id.
        IQueryable<UserTune> query = db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == callerUserId.Value);

        if (Enum.TryParse<TuneStatus>(status, ignoreCase: true, out var tuneStatus))
        {
            query = query.Where(ut => ut.Status == tuneStatus);
        }

        var userTunes = await query.ToListAsync();
        await SetSupport.PopulateTuneAndSettingAsync(db, userTunes);

        IEnumerable<UserTune> filtered = userTunes;
        if (!string.IsNullOrWhiteSpace(search))
        {
            filtered = filtered.Where(ut => ut.Tune.Title.Contains(search, StringComparison.OrdinalIgnoreCase));
        }
        if (Enum.TryParse<TuneType>(type, ignoreCase: true, out var tuneType))
        {
            filtered = filtered.Where(ut => ut.Tune.TuneType == tuneType);
        }

        var ordered = filtered.ByTitle(ut => ut.Tune.Title).ToList();

        var totalCount = ordered.Count;
        var hasMore = (page * pageSize) < totalCount;
        var pageItems = ordered.Skip((page - 1) * pageSize).Take(pageSize).ToList();

        if (summary)
        {
            // The list view deliberately skips ResolveUnpinnedSettingsAsync: it needs no ABC, so
            // an unpinned row just reports the tune's own key.
            var listItems = pageItems
                .Select(ut => new RepertoireListItemDto(
                    ut.UserTuneId,
                    ut.TuneId,
                    ut.Tune.Title,
                    ut.Tune.TuneType.ToString(),
                    ut.TuneSetting != null ? ut.TuneSetting.Key : ut.Tune.Key,
                    ut.Status.ToString(),
                    ut.LastPracticed,
                    ut.TargetBpm,
                    ut.Tune.Difficulty))
                .ToList();

            return new OkObjectResult(new PagedResult<RepertoireListItemDto>(listItems, totalCount, page, pageSize, hasMore));
        }

        await RepertoireSupport.ResolveUnpinnedSettingsAsync(db, pageItems);
        var items = pageItems.Select(RepertoireSupport.ToItemDto).ToList();

        return new OkObjectResult(new PagedResult<RepertoireItemDto>(items, totalCount, page, pageSize, hasMore));
    }
}
