namespace SessionApp.Api.Models;

/// <summary>A band or session group with shared dashboards.</summary>
public class Group
{
    public Guid GroupId { get; set; } = Guid.CreateVersion7();
    public string Name { get; set; } = string.Empty;
    public bool IsPrivate { get; set; }
    public string? InviteCode { get; set; }

    public ICollection<GroupMembership> Memberships { get; set; } = new List<GroupMembership>();
    public ICollection<GroupTune> GroupTunes { get; set; } = new List<GroupTune>();
}
