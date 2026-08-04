using System;
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

    /// <summary>Human-readable label for a badge key, for display in feeds/notifications. Badge labels live
    /// only in code (there is no badge table), so this is the single source of truth for them.</summary>
    public static string BadgeLabel(string badgeKey) => badgeKey switch
    {
        "first-practice" => "First Practice",
        "active-5" => "5 Active Tunes",
        "active-20" => "20 Active Tunes",
        "streak-7" => "7-Day Streak",
        "streak-30" => "30-Day Streak",
        "streak-100" => "100-Day Streak",
        "streak-365" => "365-Day Streak",
        _ => badgeKey,
    };

    /// <summary>True if the badge key is a streak milestone (e.g. "streak-30"), yielding the day count.</summary>
    public static bool TryGetStreakDays(string badgeKey, out int days)
    {
        days = 0;
        return badgeKey.StartsWith("streak-", StringComparison.Ordinal)
            && int.TryParse(badgeKey.AsSpan(7), out days);
    }

    /// <summary>
    /// Awards points for a qualifying action, unless the same (user, reason, sourceId) has
    /// already been awarded — the idempotency guard against double-clicks/retried requests.
    /// Returns the keys of any badges newly earned as a result.
    /// </summary>
    public async Task<IReadOnlyList<string>> AwardPointsAsync(Guid userId, PointsReason reason, string sourceId, User? user = null, bool saveImmediately = true)
    {
        var alreadyAwarded = await db.PointsTransactions
            .AsNoTracking()
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

        var newBadges = await EvaluateBadgesAsync(userId, user, saveImmediately: false);

        if (saveImmediately)
        {
            await db.SaveChangesAsync();
        }

        return newBadges;
    }

    /// <summary>
    /// Re-evaluates badge thresholds without an accompanying points award — for state changes
    /// that can newly qualify a badge on their own (e.g. a tune's status flipping to Active),
    /// as opposed to an explicitly points-earning action.
    /// </summary>
    public async Task<IReadOnlyList<string>> CheckBadgesAsync(Guid userId) =>
        await EvaluateBadgesAsync(userId, user: null, saveImmediately: true);

    private async Task<IReadOnlyList<string>> EvaluateBadgesAsync(Guid userId, User? user, bool saveImmediately)
    {
        var earnedKeys = (await db.UserBadges
            .AsNoTracking()
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

        user ??= await db.Users.SingleAsync(u => u.UserId == userId);
        var today = DateTime.UtcNow.Date;
        var effectiveStreak = (user.StreakAnchorDate.HasValue &&
            (user.StreakAnchorDate.Value.Date == today || user.StreakAnchorDate.Value.Date == today.AddDays(-1)))
            ? user.CurrentStreak
            : 0;

        if (effectiveStreak > 0)
        {
            Award("first-practice");
            if (effectiveStreak >= 7) Award("streak-7", Streak7BonusPoints);
            if (effectiveStreak >= 30) Award("streak-30", Streak30BonusPoints);
            if (effectiveStreak >= 100) Award("streak-100", Streak100BonusPoints);
            if (effectiveStreak >= 365) Award("streak-365", Streak365BonusPoints);
        }

        var activeCount = await db.UserTunes.CountAsync(ut => ut.UserId == userId && ut.Status == TuneStatus.Active);
        if (activeCount >= ActiveTunesForFirstBadge) Award("active-5");
        if (activeCount >= ActiveTunesForSecondBadge) Award("active-20");

        if (saveImmediately && db.ChangeTracker.HasChanges())
        {
            await db.SaveChangesAsync();
        }
        return newlyEarned;
    }
}
