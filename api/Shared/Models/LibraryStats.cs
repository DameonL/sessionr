namespace SessionApp.Api.Models;

/// <summary>
/// Single-document counter cache for the tune library, so an unfiltered browse/search
/// doesn't need to re-count every tune on each request (Cosmos has no cheap server-side
/// COUNT — see CosmosStitch.CosmosCountAsync). Always the one row identified by SingletonId.
/// </summary>
public class LibraryStats
{
    public static readonly Guid SingletonId = Guid.Parse("00000000-0000-0000-0000-000000000001");

    public Guid LibraryStatsId { get; set; } = SingletonId;
    public int TuneCount { get; set; }
}
