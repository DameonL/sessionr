using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

/// <summary>Shared feed-assembly logic used by both the public (view) and private (authenticated) group endpoints.</summary>
public static class GroupFeedSupport
{
    public static async Task<List<GroupFeedEventDto>> BuildGroupFeedAsync(AppDbContext db, System.Guid groupId)
    {
        var events = await db.GroupFeedEvents
            .AsNoTracking()
            .Where(e => e.GroupId == groupId)
            .OrderByDescending(e => e.CreatedAt)
            .Take(25)
            .Select(e => new { e.EventType, e.Payload, e.CreatedAt, MemberName = e.User.DisplayName })
            .ToListAsync();

        var referencedTuneIds = events
            .Where(e => e.EventType == GroupFeedEventType.TuneLearned)
            .SelectMany(e => JsonSerializer.Deserialize<TuneLearnedPayload>(e.Payload)?.TuneIds ?? new List<System.Guid>())
            .Distinct()
            .ToList();

        var tuneTitles = await db.Tunes
            .AsNoTracking()
            .Where(t => referencedTuneIds.Contains(t.TuneId))
            .ToDictionaryAsync(t => t.TuneId, t => t.Title);

        return events.Select(e =>
        {
            var tuneTitlesForEvent = new List<string>();
            if (e.EventType == GroupFeedEventType.TuneLearned)
            {
                var payload = JsonSerializer.Deserialize<TuneLearnedPayload>(e.Payload);
                if (payload != null)
                {
                    tuneTitlesForEvent = payload.TuneIds
                        .Select(id => tuneTitles.GetValueOrDefault(id))
                        .Where(title => title != null)
                        .Select(title => title!)
                        .ToList();
                }
            }
            return new GroupFeedEventDto(e.MemberName, e.EventType.ToString(), tuneTitlesForEvent, e.CreatedAt);
        }).ToList();
    }
}
