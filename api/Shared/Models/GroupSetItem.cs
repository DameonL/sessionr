namespace SessionApp.Api.Models;

/// <summary>One tune's position within a group set (join entity for GroupSet–GroupTune).</summary>
public class GroupSetItem
{
    public Guid GroupSetItemId { get; set; } = Guid.CreateVersion7();
    public Guid GroupSetId { get; set; }
    public Guid GroupTuneId { get; set; }
    public int SequenceNumber { get; set; }

    /// <summary>How many times through this tune before moving to the next (trad default: 2).</summary>
    public int Repetitions { get; set; } = 2;

    public GroupSet GroupSet { get; set; } = null!;
    public GroupTune GroupTune { get; set; } = null!;
}
