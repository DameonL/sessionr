namespace SessionApp.Api.Models;

/// <summary>One badge a user has earned. The badge catalog itself (label, description, criteria)
/// lives in code (see GamificationService), not the database — this row is just the earned record.</summary>
public class UserBadge
{
    public Guid UserBadgeId { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    public string BadgeKey { get; set; } = null!;
    public DateTime EarnedAt { get; set; } = DateTime.UtcNow;

    public User User { get; set; } = null!;
}
