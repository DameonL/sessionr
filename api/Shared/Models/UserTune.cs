namespace SessionApp.Api.Models;

/// <summary>
/// A user's personal instance of a global tune (join entity for the
/// User–Tune many-to-many, carrying per-user practice state).
/// </summary>
public class UserTune
{
    public Guid UserTuneId { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    public Guid TuneId { get; set; }
    public TuneStatus Status { get; set; }
    public string? CustomAbcText { get; set; }
    public DateTime? LastPracticed { get; set; }
    public int? TargetBpm { get; set; }

    public Guid? TuneSettingId { get; set; }
    public TuneSetting? TuneSetting { get; set; }

    public User User { get; set; } = null!;
    public Tune Tune { get; set; } = null!;
    public ICollection<SetItem> SetItems { get; set; } = new List<SetItem>();
    public ICollection<PracticeLogEntry> PracticeLog { get; set; } = new List<PracticeLogEntry>();
}
