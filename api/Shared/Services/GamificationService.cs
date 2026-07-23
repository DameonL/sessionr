using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Services;

/// <summary>
/// Central entry point for awarding gamification points and evaluating badge thresholds.
/// Every gamified action (practice, and eventually voting, contributions, session
/// check-ins, ...) should call AwardPointsAsync rather than writing to PointsTransactions/
/// UserBadges directly, so badge logic lives in one place instead of scattered across
/// endpoints. The badge catalog itself is static (see EvaluateBadgesAsync) — no admin UI
/// or database table, just code, so adding a badge is a code change, not a migration.
/// </summary>
public class GamificationService(AppDbContext db)
{
    private static readonly Dictionary<PointsReason, int> PointsByReason = new()
    {
        [PointsReason.PracticeLogged] = 5,
    };

    private const int Streak7BonusPoints = 25;
    private const int Streak30BonusPoints = 100;
    private const int Streak100BonusPoints = 300;
    private const int Streak365BonusPoints = 1000;

    private const int ActiveTunesForFirstBadge = 5;
    private const int ActiveTunesForSecondBadge = 20;

    /// <summary>
    /// Awards points for a qualifying action, unless the same (user, reason, sourceId) has
    /// already been awarded — the idempotency guard against double-clicks/retried requests.
    /// Returns the keys of any badges newly earned as a result (empty if the award was a
    /// no-op repeat, since any badge it would have triggered was already awarded the first time).
    /// </summary>
    public async Task<IReadOnlyList<string>> AwardPointsAsync(Guid userId, PointsReason reason, string sourceId)
    {
        var alreadyAwarded = await db.PointsTransactions
            .AnyAsync(t => t.UserId == userId && t.Reason == reason && t.SourceId == sourceId);
        if (alreadyAwarded)
        {
            return Array.Empty<string>();
        }

        db.PointsTransactions.Add(new PointsTransaction
        {
            UserId = userId,
            Points = PointsByReason[reason],
            Reason = reason,
            SourceId = sourceId,
        });
        await db.SaveChangesAsync();

        return await EvaluateBadgesAsync(userId);
    }

    /// <summary>
    /// Re-evaluates badge thresholds without an accompanying points award — for state changes
    /// that can newly qualify a badge on their own (e.g. a tune's status flipping to Active),
    /// as opposed to an explicitly points-earning action.
    /// </summary>
    public async Task<IReadOnlyList<string>> CheckBadgesAsync(Guid userId) => await EvaluateBadgesAsync(userId);

    private async Task<IReadOnlyList<string>> EvaluateBadgesAsync(Guid userId)
    {
        var earnedKeys = (await db.UserBadges
            .Where(b => b.UserId == userId)
            .Select(b => b.BadgeKey)
            .ToListAsync())
            .ToHashSet();
        var newlyEarned = new List<string>();

        void Award(string key, int bonusPoints = 0)
        {
            if (!earnedKeys.Add(key))
            {
                return;
            }
            db.UserBadges.Add(new UserBadge { UserId = userId, BadgeKey = key });
            if (bonusPoints > 0)
            {
                db.PointsTransactions.Add(new PointsTransaction
                {
                    UserId = userId,
                    Points = bonusPoints,
                    Reason = PointsReason.StreakMilestone,
                    SourceId = key,
                });
            }
            newlyEarned.Add(key);
        }

        var practiceTimestamps = await db.PracticeLog
            .Where(p => p.UserTune.UserId == userId)
            .Select(p => p.PracticedAt)
            .ToListAsync();

        if (practiceTimestamps.Count > 0)
        {
            Award("first-practice");

            var streak = PracticeStreakCalculator.ComputeCurrentStreak(practiceTimestamps, DateTime.UtcNow);
            if (streak >= 7) Award("streak-7", Streak7BonusPoints);
            if (streak >= 30) Award("streak-30", Streak30BonusPoints);
            if (streak >= 100) Award("streak-100", Streak100BonusPoints);
            if (streak >= 365) Award("streak-365", Streak365BonusPoints);
        }

        var activeCount = await db.UserTunes.CountAsync(ut => ut.UserId == userId && ut.Status == TuneStatus.Active);
        if (activeCount >= ActiveTunesForFirstBadge) Award("active-5");
        if (activeCount >= ActiveTunesForSecondBadge) Award("active-20");

        if (newlyEarned.Count > 0)
        {
            await db.SaveChangesAsync();
        }
        return newlyEarned;
    }
}
