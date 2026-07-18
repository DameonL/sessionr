namespace SessionApp.Api.Models;

/// <summary>One tune's position within a set (join entity for Set–UserTune).</summary>
public class SetItem
{
    public int SetItemId { get; set; }
    public int SetId { get; set; }
    public int UserTuneId { get; set; }
    public int SequenceNumber { get; set; }

    /// <summary>How many times through this tune before moving to the next (trad default: 2).</summary>
    public int Repetitions { get; set; } = 2;

    public Set Set { get; set; } = null!;
    public UserTune UserTune { get; set; } = null!;
}
