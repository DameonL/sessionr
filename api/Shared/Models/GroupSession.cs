namespace SessionApp.Api.Models;

/// <summary>A scheduled real-world meetup for a group (e.g. a weekly session at a pub).</summary>
public class GroupSession
{
    public Guid GroupSessionId { get; set; } = Guid.CreateVersion7();
    public Guid GroupId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Location { get; set; }
    public DateTime StartsAt { get; set; }
    public string? Notes { get; set; }
    public bool IsCancelled { get; set; }
    public Guid CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Group Group { get; set; } = null!;
    public User CreatedByUser { get; set; } = null!;
    public ICollection<SessionRsvp> Rsvps { get; set; } = new List<SessionRsvp>();
}
