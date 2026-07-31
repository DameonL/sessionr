using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
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

        IQueryable<UserTune> query = db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == callerUserId.Value)
            .Include(ut => ut.Tune)
            .Include(ut => ut.TuneSetting);

        if (!string.IsNullOrWhiteSpace(search))
        {
            query = query.Where(ut => EF.Functions.Like(ut.Tune.Title, $"%{search}%"));
        }
        if (Enum.TryParse<TuneType>(type, ignoreCase: true, out var tuneType))
        {
            query = query.Where(ut => ut.Tune.TuneType == tuneType);
        }
        if (Enum.TryParse<TuneStatus>(status, ignoreCase: true, out var tuneStatus))
        {
            query = query.Where(ut => ut.Status == tuneStatus);
        }

        var totalCount = await query.CountAsync();

        var ordered = query
            .OrderBy(ut => ut.Tune.Title.StartsWith("The ") ? ut.Tune.Title.Substring(4)
                : ut.Tune.Title.StartsWith("A ") ? ut.Tune.Title.Substring(2)
                : ut.Tune.Title)
            .Skip((page - 1) * pageSize)
            .Take(pageSize);

        var hasMore = (page * pageSize) < totalCount;

        if (summary)
        {
            var listItems = await ordered
                .Select(ut => new RepertoireListItemDto(
                    ut.UserTuneId,
                    ut.TuneId,
                    ut.Tune.Title,
                    ut.Tune.TuneType.ToString(),
                    ut.TuneSetting != null ? ut.TuneSetting.Key : ut.Tune.Key,
                    ut.Status.ToString(),
                    ut.LastPracticed,
                    ut.TargetBpm))
                .ToListAsync();

            return new OkObjectResult(new PagedResult<RepertoireListItemDto>(listItems, totalCount, page, pageSize, hasMore));
        }

        var items = await ordered
            .Select(ut => new RepertoireItemDto(
                ut.UserTuneId,
                ut.TuneId,
                ut.Tune.Title,
                ut.Tune.TuneType.ToString(),
                ut.TuneSetting != null ? ut.TuneSetting.Key : ut.Tune.Key,
                ut.Status.ToString(),
                ut.LastPracticed,
                ut.TargetBpm,
                ut.CustomAbcText ?? (ut.TuneSetting != null ? ut.TuneSetting.AbcText : ut.Tune.MasterAbcText),
                ut.CustomAbcText != null))
            .ToListAsync();

        return new OkObjectResult(new PagedResult<RepertoireItemDto>(items, totalCount, page, pageSize, hasMore));
    }
}
