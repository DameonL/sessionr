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
        [PointsReason.IntervalRound] = 5,
    };

    private const int Streak7BonusPoints = 25;
    private const int Streak30BonusPoints = 100;
    private const int Streak100BonusPoints = 300;
    private const int Streak365BonusPoints = 1000;

    private const int ActiveTunesForFirstBadge = 5;
    private const int ActiveTunesForSecondBadge = 20;

    /// <summary>Interval rounds that score points per local day; later rounds are recorded at 0.
    /// Matches a round to one tune's practice log, and keeps the drill from being farmed.</summary>
    public const int IntervalRoundsScoredPerDay = 3;
    /// <summary>The shortest round the trainer offers; anything shorter isn't a round.</summary>
    public const int IntervalRoundMinQuestions = 5;
    /// <summary>A perfect round only counts at this length, so five lucky guesses don't earn it.</summary>
    private const int IntervalPerfectMinQuestions = 10;
    private static readonly int[] IntervalRoundMilestones = [10, 50, 200];

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
        "interval-first" => "First Interval Round",
        "interval-perfect" => "Perfect Interval Round",
        "interval-perfect-play" => "Perfect Round by Ear",
        "interval-rounds-10" => "10 Interval Rounds",
        "interval-rounds-50" => "50 Interval Rounds",
        "interval-rounds-200" => "200 Interval Rounds",
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
        var existingTransactions = await db.PointsTransactions
            .AsNoTracking()
            .Where(t => t.UserId == userId && t.SourceId == sourceId)
            .ToListAsync();
        var alreadyAwarded = existingTransactions.Any(t => t.Reason == reason);
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
    /// Records one finished interval-training round: 5 points for each of the day's first
    /// IntervalRoundsScoredPerDay rounds, 0 after that, plus any interval badges it earns.
    ///
    /// Every round gets a ledger row, scored or not, so "rounds completed" can be counted from
    /// the ledger without an interval table of its own. SourceId is "interval:{localDate}:{roundId}":
    /// the date groups a day's rounds for the cap, and the round id makes a retry a no-op — matched
    /// on the id alone, so a retry that lands after local midnight is still recognised.
    ///
    /// Scores are reported by the client and not re-derived here. That matches the rest of the API,
    /// and the daily cap bounds what a forged request could gain.
    /// </summary>
    public async Task<IntervalRoundResult> RecordIntervalRoundAsync(
        Guid userId, Guid roundId, int questionCount, int correctCount, bool answeredByPlaying, DateTime localToday)
    {
        var roundSuffix = $":{roundId}";
        var priorRounds = await db.PointsTransactions
            .AsNoTracking()
            .Where(t => t.UserId == userId && t.Reason == PointsReason.IntervalRound)
            .Select(t => t.SourceId)
            .ToListAsync();

        if (priorRounds.Any(id => id != null && id.EndsWith(roundSuffix, StringComparison.Ordinal)))
        {
            return new IntervalRoundResult(0, false, Array.Empty<string>());
        }

        var todayPrefix = $"interval:{localToday:yyyy-MM-dd}:";
        var scoredToday = priorRounds.Count(id => id != null && id.StartsWith(todayPrefix, StringComparison.Ordinal));
        var capReached = scoredToday >= IntervalRoundsScoredPerDay;
        var points = capReached ? 0 : PointsByReason[PointsReason.IntervalRound];

        db.PointsTransactions.Add(new PointsTransaction
        {
            UserId = userId,
            Points = points,
            Reason = PointsReason.IntervalRound,
            SourceId = $"{todayPrefix}{roundId}",
        });

        var earnedKeys = (await db.UserBadges
            .AsNoTracking()
            .Where(b => b.UserId == userId)
            .Select(b => b.BadgeKey)
            .ToListAsync())
            .ToHashSet();
        var newlyEarned = new List<string>();
        void Award(string key)
        {
            if (!earnedKeys.Add(key)) return;
            db.UserBadges.Add(new UserBadge { UserId = userId, BadgeKey = key });
            newlyEarned.Add(key);
        }

        Award("interval-first");
        var perfect = questionCount >= IntervalPerfectMinQuestions && correctCount == questionCount;
        if (perfect) Award("interval-perfect");
        if (perfect && answeredByPlaying) Award("interval-perfect-play");

        // This round isn't in priorRounds yet, hence the + 1.
        var roundsCompleted = priorRounds.Count + 1;
        foreach (var milestone in IntervalRoundMilestones)
        {
            if (roundsCompleted >= milestone) Award($"interval-rounds-{milestone}");
        }

        await db.SaveChangesAsync();
        return new IntervalRoundResult(points, capReached, newlyEarned);
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
        var effectiveStreak = PracticeStreakCalculator.EffectiveStreak(user.CurrentStreak, user.StreakAnchorDate, DateTime.UtcNow);

        if (effectiveStreak > 0)
        {
            Award("first-practice");
            if (effectiveStreak >= 7) Award("streak-7", Streak7BonusPoints);
            if (effectiveStreak >= 30) Award("streak-30", Streak30BonusPoints);
            if (effectiveStreak >= 100) Award("streak-100", Streak100BonusPoints);
            if (effectiveStreak >= 365) Award("streak-365", Streak365BonusPoints);
        }

        var userTunes = await db.UserTunes.AsNoTracking().Where(ut => ut.UserId == userId).ToListAsync();
        var activeCount = userTunes.Count(ut => ut.Status == TuneStatus.Active);
        if (activeCount >= ActiveTunesForFirstBadge) Award("active-5");
        if (activeCount >= ActiveTunesForSecondBadge) Award("active-20");

        if (saveImmediately && db.ChangeTracker.HasChanges())
        {
            await db.SaveChangesAsync();
        }
        return newlyEarned;
    }
}

/// <summary>What recording an interval round produced; see GamificationService.RecordIntervalRoundAsync.</summary>
public record IntervalRoundResult(int PointsAwarded, bool DailyCapReached, IReadOnlyList<string> NewBadges);
