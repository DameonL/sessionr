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

    public RecurrencePattern RecurrencePattern { get; set; } = RecurrencePattern.None;
    public DayOfWeek? RecurrenceDayOfWeek { get; set; }
    public int? RecurrenceWeekOfMonth { get; set; }
    public string? MeetingTime { get; set; }
    public string? MeetingScheduleText { get; set; }

    public ICollection<GroupMembership> Memberships { get; set; } = new List<GroupMembership>();
    public ICollection<GroupTune> GroupTunes { get; set; } = new List<GroupTune>();
    public ICollection<GroupUpdate> Updates { get; set; } = new List<GroupUpdate>();
}
