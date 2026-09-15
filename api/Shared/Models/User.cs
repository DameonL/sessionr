namespace SessionApp.Api.Models;

public class User
{
    public Guid UserId { get; set; } = Guid.CreateVersion7();
    public string DisplayName { get; set; } = string.Empty;
    public string? Username { get; set; }
    public string Email { get; set; } = string.Empty;
    public string? Bio { get; set; }
    public string? Location { get; set; }
    public string? Instruments { get; set; }

    /// <summary>
    /// Hides the public profile and everything hanging off it. Stored negatively on purpose: Cosmos
    /// documents written before this property existed have no such field, and EF materializes a
    /// missing property as the CLR default — so "absent" has to mean "public" or every existing user
    /// would go dark on deploy.
    /// </summary>
    public bool IsProfilePrivate { get; set; }

    public int CurrentStreak { get; set; } = 0;
    public DateTime? StreakAnchorDate { get; set; }

    public ICollection<UserTune> UserTunes { get; set; } = new List<UserTune>();
    public ICollection<Set> Sets { get; set; } = new List<Set>();
    public ICollection<GroupMembership> GroupMemberships { get; set; } = new List<GroupMembership>();
}
