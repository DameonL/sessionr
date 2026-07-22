using System;

namespace SessionApp.Api.Models;

/// <summary>A system-generated entry in a group's activity feed (tune learned, member joined, ...).</summary>
public class GroupFeedEvent
{
    public Guid GroupFeedEventId { get; set; } = Guid.CreateVersion7();
    public Guid GroupId { get; set; }
    public Guid UserId { get; set; }
    public GroupFeedEventType EventType { get; set; }
    /// <summary>JSON payload whose shape depends on EventType (e.g. TuneLearnedPayload).</summary>
    public string Payload { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Group Group { get; set; } = null!;
    public User User { get; set; } = null!;
}
