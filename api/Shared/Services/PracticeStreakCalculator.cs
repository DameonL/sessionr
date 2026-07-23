namespace SessionApp.Api.Services;

/// <summary>
/// Consecutive-day practice streak, shared by the practice-stats endpoint and the
/// gamification streak badges so both agree on exactly the same definition.
/// </summary>
public static class PracticeStreakCalculator
{
    public static int ComputeCurrentStreak(IEnumerable<DateTime> practicedAtTimestamps, DateTime utcNow)
    {
        var practiceDates = practicedAtTimestamps.Select(d => d.Date).Distinct().ToHashSet();
        var today = utcNow.Date;

        // Doesn't break until the day is fully over: if practiced today, count from today;
        // otherwise count from yesterday.
        var anchor = practiceDates.Contains(today) ? today : today.AddDays(-1);

        var streak = 0;
        for (var day = anchor; practiceDates.Contains(day); day = day.AddDays(-1))
        {
            streak++;
        }
        return streak;
    }
}
