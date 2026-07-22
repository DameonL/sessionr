using System;

namespace SessionApp.Api.Models;

/// <summary>A cancelled single occurrence of an otherwise-recurring GroupMeetingSchedule.</summary>
public class GroupScheduleException
{
    public Guid GroupScheduleExceptionId { get; set; } = Guid.CreateVersion7();
    public Guid GroupMeetingScheduleId { get; set; }
    public DateTime ExceptionDate { get; set; }
    public Guid CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public GroupMeetingSchedule GroupMeetingSchedule { get; set; } = null!;
    public User CreatedByUser { get; set; } = null!;
}
