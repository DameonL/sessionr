namespace SessionApp.Api.Models;

public enum RsvpStatus
{
    Going,
    Maybe,
    NotGoing
}

/// <summary>A member's attendance response to a scheduled GroupSession.</summary>
public class SessionRsvp
{
    public Guid SessionRsvpId { get; set; } = Guid.CreateVersion7();
    public Guid GroupSessionId { get; set; }
    public Guid UserId { get; set; }
    public RsvpStatus Status { get; set; }
    public DateTime RespondedAt { get; set; } = DateTime.UtcNow;

    public GroupSession GroupSession { get; set; } = null!;
    public User User { get; set; } = null!;
}
