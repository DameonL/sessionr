namespace SessionApp.Api.Models;

/// <summary>One gamification points award. The append-only ledger of record — total points
/// are summed from here rather than stored denormalized. SourceId scopes idempotency: the
/// same (UserId, Reason, SourceId) is never awarded twice (e.g. one UserTune+day for practice,
/// a badge key for a streak-milestone bonus).</summary>
public class PointsTransaction
{
    public Guid PointsTransactionId { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    public int Points { get; set; }
    public PointsReason Reason { get; set; }
    public string? SourceId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public User User { get; set; } = null!;
}
