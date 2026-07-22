using System;
using System.Collections.Generic;

namespace SessionApp.Api.Models;

/// <summary>A recurring or specific meeting schedule associated with a group.</summary>
public class GroupMeetingSchedule
{
    public Guid GroupMeetingScheduleId { get; set; } = Guid.CreateVersion7();
    public Guid GroupId { get; set; }
    public RecurrencePattern RecurrencePattern { get; set; } = RecurrencePattern.None;
    public DayOfWeek? RecurrenceDayOfWeek { get; set; }
    public int? RecurrenceWeekOfMonth { get; set; }
    public DateTime? StartDate { get; set; }
    public string? MeetingTime { get; set; }
    public string? MeetingScheduleText { get; set; }
    public string? MeetingDescription { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Group Group { get; set; } = null!;
    public ICollection<GroupScheduleException> Exceptions { get; set; } = new List<GroupScheduleException>();
}
