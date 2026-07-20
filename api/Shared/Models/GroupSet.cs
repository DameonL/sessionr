namespace SessionApp.Api.Models;

/// <summary>An ordered medley of tunes built by a group from its master tune list.</summary>
public class GroupSet
{
    public Guid GroupSetId { get; set; } = Guid.CreateVersion7();
    public Guid GroupId { get; set; }
    public string Title { get; set; } = string.Empty;

    public Group Group { get; set; } = null!;
    public ICollection<GroupSetItem> Items { get; set; } = new List<GroupSetItem>();
}
