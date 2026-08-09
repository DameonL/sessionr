namespace SessionApp.Api.Services;

/// <summary>
/// Consecutive-day practice streak, shared by the practice-stats endpoint and the
/// gamification streak badges so both agree on exactly the same definition.
/// Accounts for user's local timezone offset when determining calendar days.
/// </summary>
public static class PracticeStreakCalculator
{
    public static int ComputeCurrentStreak(IEnumerable<DateTime> practicedAtTimestamps, DateTime utcNow, int offsetMinutes = 0)
    {
        var localDates = practicedAtTimestamps
            .Select(d => d.AddMinutes(-offsetMinutes).Date)
            .Distinct()
            .ToHashSet();

        var localToday = utcNow.AddMinutes(-offsetMinutes).Date;
        var localYesterday = localToday.AddDays(-1);

        // Doesn't break until the local day is fully over: if practiced today, count from today;
        // otherwise count from yesterday.
        var anchor = localDates.Contains(localToday) ? localToday : localYesterday;

        var streak = 0;
        for (var day = anchor; localDates.Contains(day); day = day.AddDays(-1))
        {
            streak++;
        }
        return streak;
    }

    /// <summary>
    /// Returns the cached streak only while it is still "alive" — the anchor day is today or
    /// yesterday in the user's local timezone. Once a full local day passes without practice the
    /// streak is broken and this returns 0. Matches ComputeCurrentStreak's "doesn't break until the
    /// local day is fully over" anchoring.
    /// </summary>
    public static int EffectiveStreak(int currentStreak, DateTime? anchorDate, DateTime utcNow, int offsetMinutes = 0)
    {
        if (!anchorDate.HasValue) return 0;
        var localToday = utcNow.AddMinutes(-offsetMinutes).Date;
        var anchor = anchorDate.Value.Date;
        return (anchor == localToday || anchor == localToday.AddDays(-1)) ? currentStreak : 0;
    }
}
