namespace SessionApp.Api.Models;

/// <summary>An entry in a group's curated master tune list, with the setting the group uses.</summary>
public class GroupTune
{
    public Guid GroupTuneId { get; set; } = Guid.CreateVersion7();
    public Guid GroupId { get; set; }
    public Guid TuneId { get; set; }
    public Guid AddedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Guid? TuneSettingId { get; set; }
    public TuneSetting? TuneSetting { get; set; }

    public Group Group { get; set; } = null!;
    public Tune Tune { get; set; } = null!;
    public User AddedByUser { get; set; } = null!;
}
