namespace SessionApp.Api.Models;

/// <summary>A band or session group with shared dashboards.</summary>
public class Group
{
    public Guid GroupId { get; set; } = Guid.CreateVersion7();
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? City { get; set; }
    public bool IsPrivate { get; set; }
    public string? InviteCode { get; set; }
    public string? TimeZone { get; set; } = "UTC";
    public bool IsReviewed { get; set; } = false;
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;


    public ICollection<GroupMembership> Memberships { get; set; } = new List<GroupMembership>();
    public ICollection<GroupTune> GroupTunes { get; set; } = new List<GroupTune>();
    public ICollection<GroupUpdate> Updates { get; set; } = new List<GroupUpdate>();
    public ICollection<GroupMeetingSchedule> Schedules { get; set; } = new List<GroupMeetingSchedule>();
}
