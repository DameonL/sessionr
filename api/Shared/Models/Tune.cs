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
