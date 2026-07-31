using System;
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
    private static readonly TimeSpan GroupTuneChangeMergeWindow = TimeSpan.FromMinutes(30);
    private const int GroupTuneChangeDedupeLookback = 20;

    /// <summary>Feed event types whose JSON payload is a { TuneIds } list (vs MemberJoined's empty payload).</summary>
    private static readonly GroupFeedEventType[] TuneIdPayloadTypes =
    {
        GroupFeedEventType.TuneLearned,
        GroupFeedEventType.GroupTuneAdded,
        GroupFeedEventType.GroupTuneRemoved,
    };

    /// <summary>Feed event types that render from a pre-built action string (carried on the DTO's Detail), rather than
    /// the frontend composing text from structured tune titles / member-join wording.</summary>
    private static readonly GroupFeedEventType[] DetailTextTypes =
    {
        GroupFeedEventType.SessionScheduled,
        GroupFeedEventType.SessionCancelled,
        GroupFeedEventType.AnnouncementPosted,
        GroupFeedEventType.GroupSetCreated,
        GroupFeedEventType.StreakMilestone,
        GroupFeedEventType.BadgeEarned,
    };

    // TuneLearnedPayload and GroupTuneChangePayload are the same JSON shape ({ TuneIds }),
    // so either can deserialize any tune-id-bearing payload.
    private static List<Guid> ExtractTuneIds(string payload) =>
        JsonSerializer.Deserialize<GroupTuneChangePayload>(payload)?.TuneIds ?? new List<Guid>();

    private static T? SafeDeserialize<T>(string payload)
    {
        try { return JsonSerializer.Deserialize<T>(payload); }
        catch { return default; }
    }

    public static async Task<List<GroupFeedEventDto>> BuildGroupFeedAsync(AppDbContext db, Guid groupId, Guid? excludeUserId = null)
    {
        var query = db.GroupFeedEvents
            .AsNoTracking()
            .Where(e => e.GroupId == groupId);

        if (excludeUserId.HasValue)
        {
            query = query.Where(e => e.UserId != excludeUserId.Value);
        }

        var events = await query
            .OrderByDescending(e => e.CreatedAt)
            .Take(25)
            .Select(e => new { e.EventType, e.Payload, e.CreatedAt, MemberName = e.User.DisplayName })
            .ToListAsync();

        var referencedTuneIds = events
            .Where(e => TuneIdPayloadTypes.Contains(e.EventType))
            .SelectMany(e => ExtractTuneIds(e.Payload))
            .Distinct()
            .ToList();

        var tuneTitles = await db.Tunes
            .AsNoTracking()
            .Where(t => referencedTuneIds.Contains(t.TuneId))
            .ToDictionaryAsync(t => t.TuneId, t => t.Title);

        return events.Select(e =>
        {
            var tuneTitlesForEvent = new List<string>();
            if (TuneIdPayloadTypes.Contains(e.EventType))
            {
                tuneTitlesForEvent = ExtractTuneIds(e.Payload)
                    .Select(id => tuneTitles.GetValueOrDefault(id))
                    .Where(title => title != null)
                    .Select(title => title!)
                    .ToList();
            }
            var detail = DetailTextTypes.Contains(e.EventType)
                ? BuildActionText(e.EventType, e.Payload, tuneTitlesForEvent)
                : null;
            return new GroupFeedEventDto(e.MemberName, e.EventType.ToString(), tuneTitlesForEvent, e.CreatedAt, detail);
        }).ToList();
    }

    /// <summary>Resolves the display titles for the tune IDs referenced by the given feed events (for callers that
    /// build their own summary, e.g. the dashboard). Keyed lookups return null-safe empty lists.</summary>
    public static async Task<Dictionary<Guid, string>> ResolveTuneTitlesAsync(AppDbContext db, IEnumerable<string> payloads)
    {
        var ids = payloads.SelectMany(ExtractTuneIds).Distinct().ToList();
        if (ids.Count == 0) return new Dictionary<Guid, string>();
        return await db.Tunes
            .AsNoTracking()
            .Where(t => ids.Contains(t.TuneId))
            .ToDictionaryAsync(t => t.TuneId, t => t.Title);
    }

    /// <summary>Titles for one event's payload, given a pre-resolved id→title map.</summary>
    public static List<string> TitlesForEvent(GroupFeedEventType eventType, string payload, IReadOnlyDictionary<Guid, string> titles)
    {
        if (!TuneIdPayloadTypes.Contains(eventType)) return new List<string>();
        return ExtractTuneIds(payload)
            .Select(id => titles.GetValueOrDefault(id))
            .Where(title => title != null)
            .Select(title => title!)
            .ToList();
    }

    /// <summary>Builds the human-readable one-line summary ("{name} {action}") for a feed event, used by the dashboard activity list.</summary>
    public static string BuildSummaryText(GroupFeedEventType eventType, string memberName, string payload, IReadOnlyList<string> tuneTitles) =>
        $"{memberName} {BuildActionText(eventType, payload, tuneTitles)}";

    /// <summary>Builds just the action clause (no actor name) for a feed event. Shared by the dashboard summary and the
    /// group-detail feed's Detail field so both read identically.</summary>
    public static string BuildActionText(GroupFeedEventType eventType, string payload, IReadOnlyList<string> tuneTitles) =>
        eventType switch
        {
            GroupFeedEventType.MemberJoined => "joined the group",
            GroupFeedEventType.TuneLearned => DescribeTunes("learned", tuneTitles),
            GroupFeedEventType.GroupTuneAdded => DescribeTunes("added", tuneTitles),
            GroupFeedEventType.GroupTuneRemoved => DescribeTunes("removed", tuneTitles),
            GroupFeedEventType.SessionScheduled => DescribeSession(payload, scheduled: true),
            GroupFeedEventType.SessionCancelled => DescribeSession(payload, scheduled: false),
            GroupFeedEventType.AnnouncementPosted => $"posted an update: {TitleOf(payload)}",
            GroupFeedEventType.GroupSetCreated => $"created a set: {TitleOf(payload)}",
            GroupFeedEventType.StreakMilestone => $"hit a {SafeDeserialize<StreakMilestonePayload>(payload)?.Days ?? 0}-day practice streak!",
            GroupFeedEventType.BadgeEarned => $"earned the {SafeDeserialize<BadgeEarnedPayload>(payload)?.Label ?? "new"} badge",
            _ => "updated group tunes",
        };

    private static string DescribeTunes(string verb, IReadOnlyList<string> titles) => titles.Count switch
    {
        0 => $"{verb} tunes",
        1 => $"{verb} {titles[0]}",
        _ => $"{verb} {titles.Count} tunes: {string.Join(", ", titles)}",
    };

    private static string TitleOf(string payload) => SafeDeserialize<GroupFeedTitlePayload>(payload)?.Title ?? "";

    private static string DescribeSession(string payload, bool scheduled)
    {
        var p = SafeDeserialize<GroupSessionFeedPayload>(payload) ?? new GroupSessionFeedPayload("a session", "");
        if (!scheduled)
        {
            return $"cancelled the session: {p.Title} ({p.WhenText})";
        }
        return p.Count > 1
            ? $"scheduled {p.Count} sessions: {p.Title} (starting {p.WhenText})"
            : $"scheduled a session: {p.Title} ({p.WhenText})";
    }

    /// <summary>
    /// Records a GroupTuneAdded / GroupTuneRemoved feed event for an admin edit to the group's master
    /// tune list. Rapid successive edits of the same kind by the same actor merge into one entry within
    /// GroupTuneChangeMergeWindow. Best-effort: any failure is logged and swallowed so feed logging can
    /// never break the actual tune edit. Assumes the caller has already persisted the tune change.
    /// </summary>
    public static async Task RecordGroupTuneChangeAsync(AppDbContext db, Guid groupId, Guid actorUserId, GroupFeedEventType eventType, Guid tuneId)
    {
        try
        {
            var recentEvents = await db.GroupFeedEvents
                .Where(e => e.GroupId == groupId && e.UserId == actorUserId && e.EventType == eventType)
                .OrderByDescending(e => e.CreatedAt)
                .Take(GroupTuneChangeDedupeLookback)
                .ToListAsync();

            var alreadyRecorded = recentEvents.Any(e =>
                JsonSerializer.Deserialize<GroupTuneChangePayload>(e.Payload)?.TuneIds.Contains(tuneId) == true);
            if (alreadyRecorded)
            {
                return;
            }

            var mostRecent = recentEvents.FirstOrDefault();
            if (mostRecent != null && DateTime.UtcNow - mostRecent.CreatedAt < GroupTuneChangeMergeWindow)
            {
                var payload = JsonSerializer.Deserialize<GroupTuneChangePayload>(mostRecent.Payload)
                              ?? new GroupTuneChangePayload(new List<Guid>());
                payload.TuneIds.Add(tuneId);
                mostRecent.Payload = JsonSerializer.Serialize(payload);
                mostRecent.CreatedAt = DateTime.UtcNow;
            }
            else
            {
                db.GroupFeedEvents.Add(new GroupFeedEvent
                {
                    GroupId = groupId,
                    UserId = actorUserId,
                    EventType = eventType,
                    Payload = JsonSerializer.Serialize(new GroupTuneChangePayload(new List<Guid> { tuneId })),
                });
            }

            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to record {eventType} feed event for group {groupId}, tune {tuneId}: {ex.Message}");
        }
    }

    /// <summary>
    /// Records a single group-scoped feed event (a session scheduled/cancelled, an announcement, a set created).
    /// Best-effort: any failure is logged and swallowed so feed logging can never break the underlying action.
    /// Assumes the caller has already persisted that action.
    /// </summary>
    public static async Task RecordGroupEventAsync(AppDbContext db, Guid groupId, Guid actorUserId, GroupFeedEventType eventType, object payload)
    {
        try
        {
            db.GroupFeedEvents.Add(new GroupFeedEvent
            {
                GroupId = groupId,
                UserId = actorUserId,
                EventType = eventType,
                Payload = JsonSerializer.Serialize(payload),
            });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to record {eventType} feed event for group {groupId}: {ex.Message}");
        }
    }

    /// <summary>
    /// Fans a personal milestone (streak/badge) out to every group the user is an active member of, so peers see it.
    /// Best-effort. Callers should only pass genuinely new milestones (e.g. newly-earned badges) — no dedupe is done here.
    /// </summary>
    public static async Task RecordUserMilestoneAsync(AppDbContext db, Guid userId, GroupFeedEventType eventType, object payload)
    {
        try
        {
            var groupIds = await db.GroupMemberships
                .Where(gm => gm.UserId == userId && gm.Status == GroupMembershipStatus.Active)
                .Select(gm => gm.GroupId)
                .ToListAsync();
            if (groupIds.Count == 0)
            {
                return;
            }

            var json = JsonSerializer.Serialize(payload);
            foreach (var gid in groupIds)
            {
                db.GroupFeedEvents.Add(new GroupFeedEvent
                {
                    GroupId = gid,
                    UserId = userId,
                    EventType = eventType,
                    Payload = json,
                });
            }
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to record {eventType} milestone for user {userId}: {ex.Message}");
        }
    }
}
