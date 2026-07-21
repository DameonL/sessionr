using System;

namespace SessionApp.Api.Models;

/// <summary>An announcement or update posted by a group administrator.</summary>
public class GroupUpdate
{
    public Guid GroupUpdateId { get; set; } = Guid.CreateVersion7();
    public Guid GroupId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public Guid CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Group Group { get; set; } = null!;
    public User CreatedByUser { get; set; } = null!;
}
