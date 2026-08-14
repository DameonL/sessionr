namespace SessionApp.Api.Models;

/// <summary>Global master list entry, shared across all users.</summary>
public class Tune
{
    public Guid TuneId { get; set; } = Guid.CreateVersion7();

    /// <summary>Numeric ID on thesession.org, when imported from there — not one of our own IDs.</summary>
    public int? TheSessionId { get; set; }
    public string Title { get; set; } = string.Empty;
    public TuneType TuneType { get; set; }
    public string Key { get; set; } = string.Empty;
    public string MasterAbcText { get; set; } = string.Empty;
    public bool IsReviewed { get; set; } = false;
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public int RepertoireCount { get; set; } = 0;

    // Melodic heuristics derived from MasterAbcText by TuneHeuristics, stored so
    // set-medley joins and learning recommendations don't re-parse ABC per request.
    // MIDI values are absolute (middle C = 60); null until computed / when the ABC has no notes.
    public int? StartingMidi { get; set; }
    public int? EndingMidi { get; set; }
    public int? LowestMidi { get; set; }
    public int? HighestMidi { get; set; }
    public int NoteCount { get; set; } = 0;
    public int AccidentalCount { get; set; } = 0;
    public int PartCount { get; set; } = 0;
    /// <summary>Rough 0–100 difficulty estimate (higher = harder). See TuneHeuristics.</summary>
    public int Difficulty { get; set; } = 0;

    /// <summary>
    /// Comma-delimited signed semitone intervals between consecutive notes (repeats
    /// collapsed), computed by TuneHeuristics/MelodyFingerprint from MasterAbcText.
    /// Transposition-invariant fingerprint used by TuneMatchIndex to identify a tune
    /// from a live-played snippet. Null until computed.
    /// </summary>
    public string? FingerprintIntervals { get; set; }

    public ICollection<UserTune> UserTunes { get; set; } = new List<UserTune>();
    public ICollection<TuneAlias> Aliases { get; set; } = new List<TuneAlias>();
    public ICollection<TuneSetting> Settings { get; set; } = new List<TuneSetting>();

    public static int GetDefaultTargetBpm(TuneType tuneType)
    {
        return tuneType switch
        {
            TuneType.Reel => 110,
            TuneType.Jig => 110,
            TuneType.SlipJig => 110,
            TuneType.Waltz => 110,
            TuneType.Mazurka => 110,
            TuneType.Other => 110,
            TuneType.Hornpipe => 90,
            TuneType.March => 90,
            TuneType.Polka => 115,
            TuneType.Slide => 120,
            TuneType.Strathspey => 80,
            TuneType.Barndance => 95,
            TuneType.Air => 60,
            _ => 110
        };
    }
}
