using System.ComponentModel.DataAnnotations;

namespace SessionApp.Api.Models;

/// <summary>Resumable ear-training state for one of the user's tunes.</summary>
public class EarTrainingProgress
{
    [Key]
    public Guid EarTrainingProgressId { get; set; } = Guid.CreateVersion7();
    public Guid UserTuneId { get; set; }

    /// <summary>Next phrase to train, zero-based.</summary>
    public int PhraseIndex { get; set; }

    /// <summary>Lifetime count of notes the user gave up on and revealed.</summary>
    public int NotesRevealed { get; set; }

    public DateTime? CompletedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public UserTune UserTune { get; set; } = null!;
}
