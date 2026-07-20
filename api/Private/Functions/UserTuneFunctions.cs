using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

public class UserTuneFunctions(AppDbContext db, ILogger<UserTuneFunctions> logger)
{
    /// <summary>Tunes unplayed for this long count as rusty.</summary>
    private static readonly TimeSpan RustThreshold = TimeSpan.FromDays(30);

    private const int PracticeQueueSize = 8;

    /// <summary>GET /api/repertoire/{userId} — the user's tunes with effective ABC.</summary>
    [Function("GetRepertoire")]
    public async Task<IActionResult> GetRepertoire(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "repertoire/{userId:guid}")] HttpRequest req,
        Guid userId)
    {
        var repertoire = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == userId)
            // Trad convention: ignore a leading "The" or "A" when sorting titles.
            .OrderBy(ut => ut.Tune.Title.StartsWith("The ") ? ut.Tune.Title.Substring(4)
                : ut.Tune.Title.StartsWith("A ") ? ut.Tune.Title.Substring(2)
                : ut.Tune.Title)
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

        return new OkObjectResult(repertoire);
    }

    /// <summary>POST /api/repertoire/{userId} — add a global tune to the user's repertoire.</summary>
    [Function("AddToRepertoire")]
    public async Task<IActionResult> AddToRepertoire(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "repertoire/{userId:guid}")] HttpRequest req,
        Guid userId)
    {
        var body = await req.ReadFromJsonAsync<AddToRepertoireRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("TuneId is required.");
        }

        var tune = await db.Tunes.Include(t => t.Settings).SingleOrDefaultAsync(t => t.TuneId == body.TuneId);
        if (tune is null)
        {
            return new NotFoundObjectResult($"Tune {body.TuneId} not found.");
        }

        var exists = await db.UserTunes.AnyAsync(ut => ut.UserId == userId && ut.TuneId == body.TuneId);
        if (exists)
        {
            return new ConflictObjectResult("Tune is already in the repertoire.");
        }

        var selectedSetting = tune.Settings.FirstOrDefault(s => s.TuneSettingId == body.TuneSettingId);
        if (selectedSetting is null)
        {
            selectedSetting = tune.Settings.OrderByDescending(s => s.VoteScore).FirstOrDefault();
        }

        var userTune = new UserTune
        {
            UserId = userId,
            TuneId = body.TuneId,
            TuneSettingId = selectedSetting?.TuneSettingId,
            Status = TuneStatus.Learning,
            TargetBpm = Tune.GetDefaultTargetBpm(tune.TuneType),
        };
        db.UserTunes.Add(userTune);
        await db.SaveChangesAsync();

        logger.LogInformation("User {UserId} added tune {TuneId} to repertoire", userId, body.TuneId);

        var key = selectedSetting != null ? selectedSetting.Key : tune.Key;
        var abcText = selectedSetting != null ? selectedSetting.AbcText : tune.MasterAbcText;

        return new OkObjectResult(new RepertoireItemDto(
            userTune.UserTuneId, tune.TuneId, tune.Title, tune.TuneType.ToString(), key,
            userTune.Status.ToString(), null, userTune.TargetBpm, abcText, false));
    }

    /// <summary>PATCH /api/repertoire/items/{userTuneId} — update status, target BPM, or custom ABC.</summary>
    [Function("UpdateUserTune")]
    public async Task<IActionResult> UpdateUserTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "repertoire/items/{userTuneId:guid}")] HttpRequest req,
        Guid userTuneId)
    {
        var body = await req.ReadFromJsonAsync<UpdateUserTuneRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request body is required.");
        }

        var userTune = await db.UserTunes
            .Include(ut => ut.Tune)
            .Include(ut => ut.TuneSetting)
            .SingleOrDefaultAsync(ut => ut.UserTuneId == userTuneId);
        if (userTune is null)
        {
            return new NotFoundResult();
        }

        if (body.Status is not null)
        {
            if (!Enum.TryParse<TuneStatus>(body.Status, ignoreCase: true, out var status))
            {
                return new BadRequestObjectResult($"Unknown status '{body.Status}'.");
            }
            userTune.Status = status;
        }
        if (body.TargetBpm is not null)
        {
            userTune.TargetBpm = body.TargetBpm;
        }
        if (body.CustomAbcText is not null)
        {
            userTune.CustomAbcText = body.CustomAbcText.Length == 0 ? null : body.CustomAbcText;
        }
        if (body.TuneSettingId is not null)
        {
            userTune.TuneSettingId = body.TuneSettingId;
        }

        await db.SaveChangesAsync();

        var key = userTune.TuneSetting != null ? userTune.TuneSetting.Key : userTune.Tune.Key;
        var abcText = userTune.CustomAbcText ?? (userTune.TuneSetting != null ? userTune.TuneSetting.AbcText : userTune.Tune.MasterAbcText);

        return new OkObjectResult(new RepertoireItemDto(
            userTune.UserTuneId, userTune.TuneId, userTune.Tune.Title, userTune.Tune.TuneType.ToString(),
            key, userTune.Status.ToString(), userTune.LastPracticed, userTune.TargetBpm,
            abcText, userTune.CustomAbcText != null));
    }

    /// <summary>POST /api/repertoire/items/{userTuneId}/practiced — stamp a practice session.</summary>
    [Function("LogPractice")]
    public async Task<IActionResult> LogPractice(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "repertoire/items/{userTuneId:guid}/practiced")] HttpRequest req,
        Guid userTuneId)
    {
        var userTune = await db.UserTunes.FindAsync(userTuneId);
        if (userTune is null)
        {
            return new NotFoundResult();
        }

        userTune.LastPracticed = DateTime.UtcNow;
        db.PracticeLog.Add(new PracticeLogEntry
        {
            UserTuneId = userTune.UserTuneId,
            PracticedAt = userTune.LastPracticed.Value,
        });
        await db.SaveChangesAsync();

        return new OkObjectResult(new { userTune.UserTuneId, userTune.LastPracticed });
    }

    /// <summary>DELETE /api/repertoire/items/{userTuneId} — drop a tune from the repertoire.</summary>
    [Function("RemoveFromRepertoire")]
    public async Task<IActionResult> RemoveFromRepertoire(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "repertoire/items/{userTuneId:guid}")] HttpRequest req,
        Guid userTuneId)
    {
        var userTune = await db.UserTunes.FindAsync(userTuneId);
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
    /// GET /api/practice/{userId}/stats — streak and 30-day practice history
    /// for the dashboard. A streak is consecutive practice days ending today
    /// (or yesterday, so it isn't broken before today's session happens).
    /// </summary>
    [Function("GetPracticeStats")]
    public async Task<IActionResult> GetPracticeStats(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "practice/{userId:guid}/stats")] HttpRequest req,
        Guid userId)
    {
        var today = DateTime.UtcNow.Date;
        var windowStart = today.AddDays(-29);

        var practiceDates = (await db.PracticeLog
                .AsNoTracking()
                .Where(p => p.UserTune.UserId == userId)
                .Select(p => p.PracticedAt)
                .ToListAsync())
            .Select(d => d.Date)
            .Distinct()
            .ToHashSet();

        var streakAnchor = practiceDates.Contains(today) ? today : today.AddDays(-1);
        var streak = 0;
        for (var day = streakAnchor; practiceDates.Contains(day); day = day.AddDays(-1))
        {
            streak++;
        }

        var countsInWindow = (await db.PracticeLog
                .AsNoTracking()
                .Where(p => p.UserTune.UserId == userId && p.PracticedAt >= windowStart)
                .Select(p => p.PracticedAt)
                .ToListAsync())
            .GroupBy(d => d.Date)
            .ToDictionary(g => g.Key, g => g.Count());

        var perDay = Enumerable.Range(0, 30)
            .Select(offset =>
            {
                var day = windowStart.AddDays(offset);
                return new PracticeDayDto(day.ToString("yyyy-MM-dd"), countsInWindow.GetValueOrDefault(day));
            })
            .ToList();

        return new OkObjectResult(new PracticeStatsDto(streak, countsInWindow.Values.Sum(), perDay));
    }

    private sealed record QueueCandidate(
        UserTune Ut,
        string Category,
        string Reason,
        int? DaysSince
    );

    /// <summary>
    /// GET /api/practice/{userId}/queue — today's practice queue: a mix of songs
    /// with learning, active, and rusty status based on the last logged time they were played.
    /// </summary>
    [Function("GetPracticeQueue")]
    public async Task<IActionResult> GetPracticeQueue(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "practice/{userId:guid}/queue")] HttpRequest req,
        Guid userId)
    {
        var candidates = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == userId
                && (ut.Status == TuneStatus.Learning || ut.Status == TuneStatus.Active || ut.Status == TuneStatus.Rusty))
            .Include(ut => ut.Tune)
            .Include(ut => ut.TuneSetting)
            .ToListAsync();

        var now = DateTime.UtcNow;

        var allCandidates = candidates
            .Select(ut =>
            {
                var daysSince = ut.LastPracticed is null ? (int?)null : (int)(now - ut.LastPracticed.Value).TotalDays;
                var isRusty = ut.Status == TuneStatus.Active
                    && (ut.LastPracticed is null || now - ut.LastPracticed.Value > RustThreshold);

                string category;
                string reason;
                if (ut.Status == TuneStatus.Learning)
                {
                    category = "Learning";
                    reason = "Learning — build it up";
                }
                else if (isRusty)
                {
                    category = "Rusty";
                    reason = daysSince is null
                        ? "Rusty — never logged"
                        : $"Rusty — not played in {daysSince} days";
                }
                else
                {
                    category = "Active";
                    reason = daysSince is null
                        ? "Keep it fresh — never logged"
                        : $"Keep it fresh — played {daysSince} days ago";
                }

                return new QueueCandidate(ut, category, reason, daysSince);
            })
            .OrderByDescending(x => x.DaysSince ?? int.MaxValue)
            .ToList();

        var learningList = allCandidates.Where(x => x.Category == "Learning").ToList();
        var rustyList = allCandidates.Where(x => x.Category == "Rusty").ToList();
        var activeList = allCandidates.Where(x => x.Category == "Active").ToList();

        var selected = new List<QueueCandidate>();
        int takenLearning = 0;
        int takenRusty = 0;
        int takenActive = 0;

        // Phase 1: Try to hit targets (3 Learning, 3 Rusty, 2 Active)
        while (selected.Count < PracticeQueueSize)
        {
            bool addedAny = false;

            if (selected.Count < PracticeQueueSize && takenLearning < 3 && takenLearning < learningList.Count)
            {
                selected.Add(learningList[takenLearning]);
                takenLearning++;
                addedAny = true;
            }

            if (selected.Count < PracticeQueueSize && takenRusty < 3 && takenRusty < rustyList.Count)
            {
                selected.Add(rustyList[takenRusty]);
                takenRusty++;
                addedAny = true;
            }

            if (selected.Count < PracticeQueueSize && takenActive < 2 && takenActive < activeList.Count)
            {
                selected.Add(activeList[takenActive]);
                takenActive++;
                addedAny = true;
            }

            if (!addedAny)
            {
                break;
            }
        }

        // Phase 2: Fill remaining slots with whatever is left
        while (selected.Count < PracticeQueueSize)
        {
            bool addedAny = false;

            if (takenLearning < learningList.Count)
            {
                selected.Add(learningList[takenLearning]);
                takenLearning++;
                addedAny = true;
            }
            else if (takenRusty < rustyList.Count)
            {
                selected.Add(rustyList[takenRusty]);
                takenRusty++;
                addedAny = true;
            }
            else if (takenActive < activeList.Count)
            {
                selected.Add(activeList[takenActive]);
                takenActive++;
                addedAny = true;
            }

            if (!addedAny)
            {
                break;
            }
        }

        var queue = selected
            .OrderBy(x => x.Category == "Learning" ? 0 : x.Category == "Rusty" ? 1 : 2)
            .ThenByDescending(x => x.DaysSince ?? int.MaxValue)
            .Select(x => new PracticeQueueItemDto(
                x.Ut.UserTuneId,
                x.Ut.Tune.Title,
                x.Ut.Tune.TuneType.ToString(),
                x.Ut.TuneSetting != null ? x.Ut.TuneSetting.Key : x.Ut.Tune.Key,
                x.Ut.Status.ToString(),
                x.Ut.LastPracticed,
                x.Ut.TargetBpm,
                x.Ut.CustomAbcText ?? (x.Ut.TuneSetting != null ? x.Ut.TuneSetting.AbcText : x.Ut.Tune.MasterAbcText),
                x.Reason))
            .ToList();

        return new OkObjectResult(queue);
    }
}
