namespace SessionApp.Api.Models;

public class User
{
    public int UserId { get; set; }
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;

    public ICollection<UserTune> UserTunes { get; set; } = new List<UserTune>();
    public ICollection<Set> Sets { get; set; } = new List<Set>();
    public ICollection<Group> Groups { get; set; } = new List<Group>();
}
