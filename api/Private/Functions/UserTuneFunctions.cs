using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;


namespace SessionApp.Api.Functions;

public class UserTuneFunctions(AppDbContext db, ILogger<UserTuneFunctions> logger, GamificationService gamification)
{
    /// <summary>Tunes unplayed for this long count as rusty.</summary>
    private static readonly TimeSpan RustThreshold = TimeSpan.FromDays(30);

    /// <summary>A burst of tunes marked Active within this window collapses into one feed entry.</summary>
    private static readonly TimeSpan TuneLearnedMergeWindow = TimeSpan.FromMinutes(30);

    /// <summary>Tunes practiced within this time frame are hidden from the practice queue.</summary>
    private static readonly TimeSpan PracticeCooldown = TimeSpan.FromHours(12);

    private const int PracticeQueueSize = 8;

    /// <summary>How far back to scan a group's TuneLearned feed events for the merge-window and
    /// dedupe checks. Bounds an otherwise unbounded per-write history scan; comfortably covers
    /// realistic merge bursts. A tune re-learned after a gap of more than this many TuneLearned
    /// events in the same group could in theory be re-announced — an accepted tradeoff.</summary>
    private const int TuneLearnedDedupeLookback = 20;

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

        // The scrolling list view only needs enough to render a row and link to the tune's
        // detail page — ABC and settings are fetched separately, on demand, via
        // GetRepertoireItem below.
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

    /// <summary>
    /// GET /api/repertoire/stats — aggregate counts (total, by status, by type, rusty)
    /// computed via SQL-translated GroupBy/Count queries, for the dashboard.
    /// </summary>
    [Function("GetRepertoireStats")]
    public async Task<IActionResult> GetRepertoireStats(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "repertoire/stats")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var userTunes = db.UserTunes.AsNoTracking().Where(ut => ut.UserId == callerUserId.Value);

        var totalCount = await userTunes.CountAsync();

        var byStatusRows = await userTunes
            .GroupBy(ut => ut.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync();
        var byStatus = byStatusRows.ToDictionary(x => x.Status.ToString(), x => x.Count);

        var byTypeRows = await userTunes
            .GroupBy(ut => ut.Tune.TuneType)
            .Select(g => new { TuneType = g.Key, Count = g.Count() })
            .ToListAsync();
        var byType = byTypeRows.ToDictionary(x => x.TuneType.ToString(), x => x.Count);

        // Mirrors Dashboard's rusty heuristic: Active status AND (never practiced
        // OR not practiced within RustThreshold).
        var rustyCutoff = DateTime.UtcNow - RustThreshold;
        var rustyCount = await userTunes
            .Where(ut => ut.Status == TuneStatus.Active
                && (ut.LastPracticed == null || ut.LastPracticed < rustyCutoff))
            .CountAsync();

        return new OkObjectResult(new RepertoireStatsDto(totalCount, byStatus, byType, rustyCount));
    }

    /// <summary>GET /api/repertoire/items/{userTuneId} — full detail (including ABC) for a single repertoire tune.</summary>
    [Function("GetRepertoireItem")]
    public async Task<IActionResult> GetRepertoireItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "repertoire/items/{userTuneId:guid}")] HttpRequest req,
        Guid userTuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var userTune = await db.UserTunes
            .AsNoTracking()
            .Include(ut => ut.Tune)
            .Include(ut => ut.TuneSetting)
            .SingleOrDefaultAsync(ut => ut.UserTuneId == userTuneId && ut.UserId == callerUserId.Value);

        if (userTune is null)
        {
            return new NotFoundResult();
        }

        var effectiveKey = userTune.TuneSetting != null ? userTune.TuneSetting.Key : userTune.Tune.Key;
        var effectiveAbc = userTune.CustomAbcText ?? (userTune.TuneSetting != null ? userTune.TuneSetting.AbcText : userTune.Tune.MasterAbcText);

        return new OkObjectResult(new RepertoireItemDto(
            userTune.UserTuneId,
            userTune.TuneId,
            userTune.Tune.Title,
            userTune.Tune.TuneType.ToString(),
            effectiveKey,
            userTune.Status.ToString(),
            userTune.LastPracticed,
            userTune.TargetBpm,
            effectiveAbc,
            userTune.CustomAbcText != null));
    }

    /// <summary>POST /api/repertoire — add a global tune to the user's repertoire.</summary>
    [Function("AddToRepertoire")]
    public async Task<IActionResult> AddToRepertoire(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "repertoire")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<AddToRepertoireRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("TuneId is required.");
        }

        var tune = await db.Tunes.SingleOrDefaultAsync(t => t.TuneId == body.TuneId);
        if (tune is null)
        {
            return new NotFoundObjectResult($"Tune {body.TuneId} not found.");
        }

        var exists = await db.UserTunes.AnyAsync(ut => ut.UserId == callerUserId.Value && ut.TuneId == body.TuneId);
        if (exists)
        {
            return new ConflictObjectResult("Tune is already in the repertoire.");
        }

        if (body.TuneSettingId is not null)
        {
            var settingBelongs = await db.TuneSettings.AnyAsync(s => s.TuneSettingId == body.TuneSettingId && s.TuneId == body.TuneId);
            if (!settingBelongs)
            {
                return new BadRequestObjectResult("TuneSettingId does not belong to the given tune.");
            }
        }

        var userTune = new UserTune
        {
            UserId = callerUserId.Value,
            TuneId = body.TuneId,
            TuneSettingId = body.TuneSettingId,
            Status = TuneStatus.Learning,
            TargetBpm = Tune.GetDefaultTargetBpm(tune.TuneType),
        };
        db.UserTunes.Add(userTune);
        await db.SaveChangesAsync();

        var effectiveKey = userTune.TuneSetting != null ? userTune.TuneSetting.Key : tune.Key;
        var effectiveAbc = userTune.TuneSetting != null ? userTune.TuneSetting.AbcText : tune.MasterAbcText;

        return new OkObjectResult(new RepertoireItemDto(
            userTune.UserTuneId,
            userTune.TuneId,
            tune.Title,
            tune.TuneType.ToString(),
            effectiveKey,
            userTune.Status.ToString(),
            userTune.LastPracticed,
            userTune.TargetBpm,
            effectiveAbc,
            false));
    }

    /// <summary>PATCH /api/repertoire/items/{userTuneId} — update status, target BPM, or custom ABC.</summary>
    [Function("UpdateRepertoireItem")]
    public async Task<IActionResult> UpdateRepertoireItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "repertoire/items/{userTuneId:guid}")] HttpRequest req,
        Guid userTuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<UpdateUserTuneRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request payload is required.");
        }

        var userTune = await db.UserTunes
            .Include(ut => ut.Tune)
            .Include(ut => ut.TuneSetting)
            .SingleOrDefaultAsync(ut => ut.UserTuneId == userTuneId && ut.UserId == callerUserId.Value);

        if (userTune is null)
        {
            return new NotFoundResult();
        }

        var previousStatus = userTune.Status;

        if (body.Status is not null)
        {
            if (!Enum.TryParse<TuneStatus>(body.Status, ignoreCase: true, out var status))
            {
                return new BadRequestObjectResult($"Invalid status '{body.Status}'.");
            }
            userTune.Status = status;
        }

        if (body.TargetBpm is not null)
        {
            if (body.TargetBpm <= 0)
            {
                return new BadRequestObjectResult("TargetBpm must be positive.");
            }
            userTune.TargetBpm = body.TargetBpm.Value;
        }

        if (body.CustomAbcText is not null)
        {
            userTune.CustomAbcText = string.IsNullOrWhiteSpace(body.CustomAbcText)
                ? null
                : body.CustomAbcText.Trim();
        }

        if (body.TuneSettingId is not null)
        {
            var settingBelongs = await db.TuneSettings
                .AnyAsync(s => s.TuneSettingId == body.TuneSettingId && s.TuneId == userTune.TuneId);
            if (!settingBelongs)
            {
                return new BadRequestObjectResult("TuneSettingId does not belong to this tune.");
            }
            userTune.TuneSettingId = body.TuneSettingId;
        }

        await db.SaveChangesAsync();

        if (previousStatus != TuneStatus.Active && userTune.Status == TuneStatus.Active)
        {
            await RecordTuneLearnedFeedEventsAsync(callerUserId.Value, userTune.TuneId);
            await gamification.CheckBadgesAsync(callerUserId.Value);
        }

        var effectiveKey = userTune.TuneSetting != null ? userTune.TuneSetting.Key : userTune.Tune.Key;
        var effectiveAbc = userTune.CustomAbcText ?? (userTune.TuneSetting != null ? userTune.TuneSetting.AbcText : userTune.Tune.MasterAbcText);

        return new OkObjectResult(new RepertoireItemDto(
            userTune.UserTuneId,
            userTune.TuneId,
            userTune.Tune.Title,
            userTune.Tune.TuneType.ToString(),
            effectiveKey,
            userTune.Status.ToString(),
            userTune.LastPracticed,
            userTune.TargetBpm,
            effectiveAbc,
            userTune.CustomAbcText != null));
    }

    /// <summary>
    /// Records a "member learned a tune" feed entry in every group the user currently belongs
    /// to, once per (group, tune) ever. A burst of tunes marked Active in quick succession
    /// merges into a single recent entry per group instead of flooding the feed with one row
    /// per tune. Runs after the primary status update has already committed, in its own
    /// save/try-catch, so a failure here can never roll back the tune status change itself.
    /// </summary>
    private async Task RecordTuneLearnedFeedEventsAsync(Guid userId, Guid tuneId)
    {
        try
        {
            var groupIds = await db.GroupMemberships
                .Where(gm => gm.UserId == userId && gm.Status == GroupMembershipStatus.Active)
                .Select(gm => gm.GroupId)
                .ToListAsync();

            var allEvents = await db.GroupFeedEvents
                .Where(e => groupIds.Contains(e.GroupId) && e.UserId == userId && e.EventType == GroupFeedEventType.TuneLearned)
                .OrderByDescending(e => e.CreatedAt)
                .Take(groupIds.Count * TuneLearnedDedupeLookback)
                .ToListAsync();

            var eventsByGroup = allEvents
                .GroupBy(e => e.GroupId)
                .ToDictionary(g => g.Key, g => g.Take(TuneLearnedDedupeLookback).ToList());

            foreach (var groupId in groupIds)
            {
                var existingEvents = eventsByGroup.GetValueOrDefault(groupId) ?? new List<GroupFeedEvent>();

                var alreadyRecorded = existingEvents.Any(e =>
                    JsonSerializer.Deserialize<TuneLearnedPayload>(e.Payload)?.TuneIds.Contains(tuneId) == true);
                if (alreadyRecorded)
                {
                    continue;
                }

                var mostRecent = existingEvents.FirstOrDefault();
                if (mostRecent != null && DateTime.UtcNow - mostRecent.CreatedAt < TuneLearnedMergeWindow)
                {
                    var payload = JsonSerializer.Deserialize<TuneLearnedPayload>(mostRecent.Payload) ?? new TuneLearnedPayload(new List<Guid>());
                    payload.TuneIds.Add(tuneId);
                    mostRecent.Payload = JsonSerializer.Serialize(payload);
                    mostRecent.CreatedAt = DateTime.UtcNow;
                }
                else
                {
                    db.GroupFeedEvents.Add(new GroupFeedEvent
                    {
                        GroupId = groupId,
                        UserId = userId,
                        EventType = GroupFeedEventType.TuneLearned,
                        Payload = JsonSerializer.Serialize(new TuneLearnedPayload(new List<Guid> { tuneId })),
                    });
                }
            }

            await db.SaveChangesAsync();
        }
        catch (DbUpdateException ex)
        {
            logger.LogWarning(ex, "Failed to record TuneLearned feed event(s) for user {UserId}, tune {TuneId}.", userId, tuneId);
        }
    }

    /// <summary>POST /api/repertoire/items/{userTuneId}/practiced — log a practice event for a tune.</summary>
    [Function("MarkPracticed")]
    public async Task<IActionResult> MarkPracticed(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "repertoire/items/{userTuneId:guid}/practiced")] HttpRequest req,
        Guid userTuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var userTune = await db.UserTunes
            .Include(ut => ut.User)
            .SingleOrDefaultAsync(ut => ut.UserTuneId == userTuneId && ut.UserId == callerUserId.Value);

        if (userTune is null)
        {
            return new NotFoundResult();
        }

        var offsetMinutes = req.GetTimezoneOffsetMinutes();
        var now = DateTime.UtcNow;
        userTune.LastPracticed = now;

        var user = userTune.User;
        var localToday = now.AddMinutes(-offsetMinutes).Date;

        db.PracticeLog.Add(new PracticeLogEntry
        {
            UserTuneId = userTuneId,
            PracticedAt = now
        });

        var allTimestamps = await db.PracticeLog
            .Where(p => p.UserTune.UserId == callerUserId.Value)
            .Select(p => p.PracticedAt)
            .ToListAsync();
        allTimestamps.Add(now);

        var computedStreak = PracticeStreakCalculator.ComputeCurrentStreak(allTimestamps, now, offsetMinutes);
        user.CurrentStreak = computedStreak;
        user.StreakAnchorDate = localToday;

        var sourceId = $"{userTuneId}:{localToday:yyyy-MM-dd}";
        var newBadges = await gamification.AwardPointsAsync(callerUserId.Value, PointsReason.PracticeLogged, sourceId, user, saveImmediately: false);

        await db.SaveChangesAsync();

        return new OkObjectResult(new MarkPracticedResponseDto(userTune.UserTuneId, userTune.LastPracticed, newBadges.ToList()));
    }

    /// <summary>DELETE /api/repertoire/items/{userTuneId} — remove a tune from the user's repertoire.</summary>
    [Function("RemoveRepertoireItem")]
    public async Task<IActionResult> RemoveRepertoireItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "repertoire/items/{userTuneId:guid}")] HttpRequest req,
        Guid userTuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var userTune = await db.UserTunes
            .SingleOrDefaultAsync(ut => ut.UserTuneId == userTuneId && ut.UserId == callerUserId.Value);

        if (userTune is null)
        {
            return new NotFoundResult();
        }

        var usedInSets = await db.SetItems.AnyAsync(si => si.UserTuneId == userTuneId);
        if (usedInSets)
        {
            return new ConflictObjectResult("Tune is used in one or more sets. Remove it from those sets first.");
        }

        db.UserTunes.Remove(userTune);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }

    /// <summary>
    /// GET /api/practice/stats — streak and 30-day practice history
    /// for the dashboard.
    /// </summary>
    [Function("GetPracticeStats")]
    public async Task<IActionResult> GetPracticeStats(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "practice/stats")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var user = await db.Users
            .AsNoTracking()
            .SingleAsync(u => u.UserId == callerUserId.Value);

        var offsetMinutes = req.GetTimezoneOffsetMinutes();
        var now = DateTime.UtcNow;
        var localToday = now.AddMinutes(-offsetMinutes).Date;
        var localWindowStart = localToday.AddDays(-29);

        var allPracticeTimestamps = await db.PracticeLog
            .AsNoTracking()
            .Where(p => p.UserTune.UserId == callerUserId.Value)
            .Select(p => p.PracticedAt)
            .ToListAsync();

        var streak = PracticeStreakCalculator.ComputeCurrentStreak(allPracticeTimestamps, now, offsetMinutes);

        var countsInWindow = allPracticeTimestamps
            .Select(d => d.AddMinutes(-offsetMinutes).Date)
            .Where(d => d >= localWindowStart && d <= localToday)
            .GroupBy(d => d)
            .ToDictionary(g => g.Key, g => g.Count());

        var perDay = Enumerable.Range(0, 30)
            .Select(offset =>
            {
                var day = localWindowStart.AddDays(offset);
                return new PracticeDayDto(day.ToString("yyyy-MM-dd"), countsInWindow.GetValueOrDefault(day));
            })
            .ToList();

        return new OkObjectResult(new PracticeStatsDto(streak, countsInWindow.Values.Sum(), perDay));
    }

    private sealed record QueueCandidate(
        Guid UserTuneId,
        string Category,
        string Reason,
        int? DaysSince
    );

    /// <summary>
    /// GET /api/practice/queue — today's practice queue: a mix of songs
    /// with learning, active, and rusty status based on the last logged time they were played.
    /// </summary>
    [Function("GetPracticeQueue")]
    public async Task<IActionResult> GetPracticeQueue(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "practice/queue")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var cooldownCutoff = DateTime.UtcNow - PracticeCooldown;

        // Rank on the lightweight fields only — ABC/settings are fetched afterward, only for
        // the small number of tunes that actually make the cut.
        var candidates = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == callerUserId.Value
                && (ut.Status == TuneStatus.Learning || ut.Status == TuneStatus.Active || ut.Status == TuneStatus.Rusty)
                && (ut.LastPracticed == null || ut.LastPracticed < cooldownCutoff))
            .Select(ut => new { ut.UserTuneId, ut.Status, ut.LastPracticed })
            .ToListAsync();

        var now = DateTime.UtcNow;
        var list = new System.Collections.Generic.List<QueueCandidate>();

        foreach (var ut in candidates)
        {
            if (ut.Status == TuneStatus.Learning)
            {
                list.Add(new QueueCandidate(ut.UserTuneId, "Learning", "Actively learning", null));
            }
            else if (ut.Status == TuneStatus.Rusty)
            {
                var days = ut.LastPracticed.HasValue ? (int?)(now - ut.LastPracticed.Value).TotalDays : null;
                var reason = days.HasValue ? $"Not practiced in {days} days" : "Marked as rusty";
                list.Add(new QueueCandidate(ut.UserTuneId, "Rusty", reason, days));
            }
            else if (ut.Status == TuneStatus.Active)
            {
                if (!ut.LastPracticed.HasValue)
                {
                    list.Add(new QueueCandidate(ut.UserTuneId, "Rusty", "Active tune never logged", null));
                }
                else
                {
                    var age = now - ut.LastPracticed.Value;
                    if (age >= RustThreshold)
                    {
                        var days = (int)age.TotalDays;
                        list.Add(new QueueCandidate(ut.UserTuneId, "Rusty", $"Unplayed for {days} days", days));
                    }
                    else
                    {
                        var days = (int)age.TotalDays;
                        var reason = days == 0 ? "Practiced today" : $"Practiced {days} days ago";
                        list.Add(new QueueCandidate(ut.UserTuneId, "Maintenance", reason, days));
                    }
                }
            }
        }

        var selected = list
            .OrderBy(x => x.Category == "Learning" ? 0 : x.Category == "Rusty" ? 1 : 2)
            .ThenByDescending(x => x.DaysSince ?? int.MaxValue)
            .Take(PracticeQueueSize)
            .ToList();

        var selectedIds = selected.Select(x => x.UserTuneId).ToList();

        var fullData = await db.UserTunes
            .AsNoTracking()
            .Where(ut => selectedIds.Contains(ut.UserTuneId))
            .Include(ut => ut.Tune)
            .Include(ut => ut.TuneSetting)
            .ToDictionaryAsync(ut => ut.UserTuneId);

        var queue = selected
            .Select(x =>
            {
                var ut = fullData[x.UserTuneId];
                return new PracticeQueueItemDto(
                    ut.UserTuneId,
                    ut.Tune.Title,
                    ut.Tune.TuneType.ToString(),
                    ut.TuneSetting != null ? ut.TuneSetting.Key : ut.Tune.Key,
                    ut.Status.ToString(),
                    ut.LastPracticed,
                    ut.TargetBpm,
                    ut.CustomAbcText ?? (ut.TuneSetting != null ? ut.TuneSetting.AbcText : ut.Tune.MasterAbcText),
                    x.Reason);
            })
            .ToList();

        return new OkObjectResult(queue);
    }
}
