using System.Collections.Generic;

namespace SessionApp.Api.Models;

public class TuneSetting
{
    public Guid TuneSettingId { get; set; } = Guid.CreateVersion7();
    public Guid TuneId { get; set; }
    public string Key { get; set; } = string.Empty;
    public string AbcText { get; set; } = string.Empty;
    public string SubmitterName { get; set; } = "System";
    public int VoteScore { get; set; } = 0;

    public Tune Tune { get; set; } = null!;
    public ICollection<TuneSettingVote> Votes { get; set; } = new List<TuneSettingVote>();
    public ICollection<UserTune> UserTunes { get; set; } = new List<UserTune>();
}
