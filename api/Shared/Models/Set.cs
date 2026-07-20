namespace SessionApp.Api.Models;

/// <summary>An ordered medley of tunes built by a user.</summary>
public class Set
{
    public Guid SetId { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    public string Title { get; set; } = string.Empty;

    public User User { get; set; } = null!;
    public ICollection<SetItem> Items { get; set; } = new List<SetItem>();
}
