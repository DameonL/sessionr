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
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Practice.Queue;

public class Get(AppDbContext db)
{
    private static readonly TimeSpan RustThreshold = TimeSpan.FromDays(30);
    private static readonly TimeSpan PracticeCooldown = TimeSpan.FromHours(12);
    private const int PracticeQueueSize = 8;

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

        var candidates = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == callerUserId.Value
                && (ut.Status == TuneStatus.Learning || ut.Status == TuneStatus.Active || ut.Status == TuneStatus.Rusty)
                && (ut.LastPracticed == null || ut.LastPracticed < cooldownCutoff))
            .Select(ut => new { ut.UserTuneId, ut.Status, ut.LastPracticed })
            .ToListAsync();

        var now = DateTime.UtcNow;
        var list = new List<QueueCandidate>();

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
