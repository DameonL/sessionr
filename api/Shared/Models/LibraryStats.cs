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

    /// <summary>
    /// When a tune or setting's melodic fingerprint last changed. TuneMatchIndex lives in the
    /// Public Functions process while every write happens in the Private one, so the writer
    /// can't invalidate the index directly — it stamps this instead, and the index treats a
    /// stamp newer than its snapshot as "rebuild now" rather than waiting out its TTL.
    ///
    /// Nullable on purpose: a LibraryStats document written before this property existed simply
    /// doesn't carry it, and null reads as "never stamped" (see the projection note in
    /// TuneMatchIndex — a non-nullable DateTime here would be the same 500 all over again).
    /// </summary>
    public DateTime? TunesChangedAt { get; set; }
}
