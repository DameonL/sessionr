namespace SessionApp.Api.Models;

public class TuneSettingVote
{
    public Guid TuneSettingVoteId { get; set; } = Guid.CreateVersion7();
    public Guid TuneSettingId { get; set; }
    public Guid UserId { get; set; }
    public int Value { get; set; } // +1 or -1

    public TuneSetting TuneSetting { get; set; } = null!;
    public User User { get; set; } = null!;
}
