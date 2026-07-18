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
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "repertoire/{userId:int}")] HttpRequest req,
        int userId)
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
                ut.Tune.Key,
                ut.Status.ToString(),
                ut.LastPracticed,
                ut.TargetBpm,
                ut.CustomAbcText ?? ut.Tune.MasterAbcText,
                ut.CustomAbcText != null))
            .ToListAsync();

        return new OkObjectResult(repertoire);
    }

    /// <summary>POST /api/repertoire/{userId} — add a global tune to the user's repertoire.</summary>
    [Function("AddToRepertoire")]
    public async Task<IActionResult> AddToRepertoire(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "repertoire/{userId:int}")] HttpRequest req,
        int userId)
    {
        var body = await req.ReadFromJsonAsync<AddToRepertoireRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("TuneId is required.");
        }

        var tune = await db.Tunes.FindAsync(body.TuneId);
        if (tune is null)
        {
            return new NotFoundObjectResult($"Tune {body.TuneId} not found.");
        }

        var exists = await db.UserTunes.AnyAsync(ut => ut.UserId == userId && ut.TuneId == body.TuneId);
        if (exists)
        {
            return new ConflictObjectResult("Tune is already in the repertoire.");
        }

        var userTune = new UserTune
        {
            UserId = userId,
            TuneId = body.TuneId,
            Status = TuneStatus.Learning,
            TargetBpm = Tune.GetDefaultTargetBpm(tune.TuneType),
        };
        db.UserTunes.Add(userTune);
        await db.SaveChangesAsync();

        logger.LogInformation("User {UserId} added tune {TuneId} to repertoire", userId, body.TuneId);

        return new OkObjectResult(new RepertoireItemDto(
            userTune.UserTuneId, tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key,
            userTune.Status.ToString(), null, userTune.TargetBpm, tune.MasterAbcText, false));
    }

    /// <summary>PATCH /api/repertoire/items/{userTuneId} — update status, target BPM, or custom ABC.</summary>
    [Function("UpdateUserTune")]
    public async Task<IActionResult> UpdateUserTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "repertoire/items/{userTuneId:int}")] HttpRequest req,
        int userTuneId)
    {
        var body = await req.ReadFromJsonAsync<UpdateUserTuneRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request body is required.");
        }

        var userTune = await db.UserTunes.Include(ut => ut.Tune).SingleOrDefaultAsync(ut => ut.UserTuneId == userTuneId);
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

        await db.SaveChangesAsync();

        return new OkObjectResult(new RepertoireItemDto(
            userTune.UserTuneId, userTune.TuneId, userTune.Tune.Title, userTune.Tune.TuneType.ToString(),
            userTune.Tune.Key, userTune.Status.ToString(), userTune.LastPracticed, userTune.TargetBpm,
            userTune.CustomAbcText ?? userTune.Tune.MasterAbcText, userTune.CustomAbcText != null));
    }

    /// <summary>POST /api/repertoire/items/{userTuneId}/practiced — stamp a practice session.</summary>
    [Function("LogPractice")]
    public async Task<IActionResult> LogPractice(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "repertoire/items/{userTuneId:int}/practiced")] HttpRequest req,
        int userTuneId)
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
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "repertoire/items/{userTuneId:int}")] HttpRequest req,
        int userTuneId)
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
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "practice/{userId:int}/stats")] HttpRequest req,
        int userId)
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

    /// <summary>
    /// GET /api/practice/{userId}/queue — today's practice queue: tunes being
    /// learned first, then rusty tunes (unplayed past the rust threshold),
    /// then the least recently played active tunes to keep them fresh.
    /// </summary>
    [Function("GetPracticeQueue")]
    public async Task<IActionResult> GetPracticeQueue(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "practice/{userId:int}/queue")] HttpRequest req,
        int userId)
    {
        var candidates = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == userId
                && (ut.Status == TuneStatus.Learning || ut.Status == TuneStatus.Active))
            .Include(ut => ut.Tune)
            .ToListAsync();

        var now = DateTime.UtcNow;

        var queue = candidates
            .Select(ut =>
            {
                var daysSince = ut.LastPracticed is null ? (int?)null : (int)(now - ut.LastPracticed.Value).TotalDays;
                var isRusty = ut.Status == TuneStatus.Active
                    && (ut.LastPracticed is null || now - ut.LastPracticed.Value > RustThreshold);
                var (priority, reason) = ut.Status switch
                {
                    TuneStatus.Learning => (0, "Learning — build it up"),
                    _ when isRusty => (1, daysSince is null
                        ? "Rusty — never logged"
                        : $"Rusty — not played in {daysSince} days"),
                    _ => (2, "Keep it fresh"),
                };
                return (ut, priority, reason, daysSince);
            })
            .OrderBy(x => x.priority)
            .ThenByDescending(x => x.daysSince ?? int.MaxValue)
            .Take(PracticeQueueSize)
            .Select(x => new PracticeQueueItemDto(
                x.ut.UserTuneId,
                x.ut.Tune.Title,
                x.ut.Tune.TuneType.ToString(),
                x.ut.Tune.Key,
                x.ut.Status.ToString(),
                x.ut.LastPracticed,
                x.ut.TargetBpm,
                x.ut.CustomAbcText ?? x.ut.Tune.MasterAbcText,
                x.reason))
            .ToList();

        return new OkObjectResult(queue);
    }
}
