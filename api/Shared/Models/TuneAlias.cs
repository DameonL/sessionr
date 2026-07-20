namespace SessionApp.Api.Models;

public class TuneAlias
{
    public Guid TuneAliasId { get; set; } = Guid.CreateVersion7();
    public Guid TuneId { get; set; }
    public string Name { get; set; } = string.Empty;

    public Tune Tune { get; set; } = null!;
}
