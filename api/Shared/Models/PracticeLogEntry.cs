using System.ComponentModel.DataAnnotations;

namespace SessionApp.Api.Models;

/// <summary>One recorded practice session for one of the user's tunes.</summary>
public class PracticeLogEntry
{
    [Key]
    public Guid PracticeLogId { get; set; } = Guid.CreateVersion7();
    public Guid UserTuneId { get; set; }
    public DateTime PracticedAt { get; set; }

    public UserTune UserTune { get; set; } = null!;
}
