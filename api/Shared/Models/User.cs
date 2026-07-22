namespace SessionApp.Api.Models;

public class User
{
    public Guid UserId { get; set; } = Guid.CreateVersion7();
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? Bio { get; set; }
    public string? Location { get; set; }
    public string? Instruments { get; set; }

    public ICollection<UserTune> UserTunes { get; set; } = new List<UserTune>();
    public ICollection<Set> Sets { get; set; } = new List<Set>();
    public ICollection<GroupMembership> GroupMemberships { get; set; } = new List<GroupMembership>();
}
