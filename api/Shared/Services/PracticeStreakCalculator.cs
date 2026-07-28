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
}
