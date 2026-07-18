namespace SessionApp.Api.Models;

/// <summary>
/// A user's personal instance of a global tune (join entity for the
/// User–Tune many-to-many, carrying per-user practice state).
/// </summary>
public class UserTune
{
    public int UserTuneId { get; set; }
    public int UserId { get; set; }
    public int TuneId { get; set; }
    public TuneStatus Status { get; set; }
    public string? CustomAbcText { get; set; }
    public DateTime? LastPracticed { get; set; }
    public int? TargetBpm { get; set; }

    public User User { get; set; } = null!;
    public Tune Tune { get; set; } = null!;
    public ICollection<SetItem> SetItems { get; set; } = new List<SetItem>();
    public ICollection<PracticeLogEntry> PracticeLog { get; set; } = new List<PracticeLogEntry>();
}
