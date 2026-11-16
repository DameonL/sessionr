using System;
using System.Collections.Generic;
using System.Linq;
using SessionApp.Api.Functions;

namespace SessionApp.Api.Services;

public record PracticeLogItem(Guid UserTuneId, DateTime PracticedAt);

/// <summary>
/// Calculates practice statistics:
/// - Current streak (consecutive days)
/// - How many tunes a day a user has practiced (distinct tunes and total sessions)
/// - Practice consistency (practiced days out of last week, month, year)
/// - Tunes practiced today and average tunes per practice day
/// Accounts for user's local timezone offset when determining calendar days.
/// </summary>
public static class PracticeStatsCalculator
{
    public const int WeekWindowDays = 7;
    public const int MonthWindowDays = 30;
    public const int YearWindowDays = 365;

    public static PracticeStatsDto Calculate(
        IEnumerable<PracticeLogItem> entries,
        DateTime utcNow,
        int offsetMinutes = 0)
    {
        var entryList = entries as IList<PracticeLogItem> ?? entries.ToList();

        var localToday = utcNow.AddMinutes(-offsetMinutes).Date;
        var weekStart = localToday.AddDays(-(WeekWindowDays - 1));
        var monthStart = localToday.AddDays(-(MonthWindowDays - 1));
        var yearStart = localToday.AddDays(-(YearWindowDays - 1));

        // Group by user's local date
        var groupedByDate = entryList
            .GroupBy(e => e.PracticedAt.AddMinutes(-offsetMinutes).Date)
            .ToDictionary(
                g => g.Key,
                g => new
                {
                    DistinctTunes = g.Select(x => x.UserTuneId).Distinct().Count(),
                    TotalSessions = g.Count()
                });

        // Compute streak
        var streak = PracticeStreakCalculator.ComputeCurrentStreak(
            entryList.Select(e => e.PracticedAt),
            utcNow,
            offsetMinutes);

        // Tunes practiced today
        var tunesPracticedToday = groupedByDate.TryGetValue(localToday, out var todayStats)
            ? todayStats.DistinctTunes
            : 0;

        // Average tunes per practice day (only across days where practice actually occurred)
        var totalPracticeDays = groupedByDate.Count;
        var totalDistinctTunesAcrossDays = groupedByDate.Values.Sum(v => v.DistinctTunes);
        var averageTunesPerPracticeDay = totalPracticeDays > 0
            ? Math.Round((double)totalDistinctTunesAcrossDays / totalPracticeDays, 1)
            : 0.0;

        // Consistency across rolling windows
        var daysPracticedWeek = groupedByDate.Keys.Count(d => d >= weekStart && d <= localToday);
        var daysPracticedMonth = groupedByDate.Keys.Count(d => d >= monthStart && d <= localToday);
        var daysPracticedYear = groupedByDate.Keys.Count(d => d >= yearStart && d <= localToday);

        var lastWeek = new PracticeFrequencyDto(daysPracticedWeek, WeekWindowDays);
        var lastMonth = new PracticeFrequencyDto(daysPracticedMonth, MonthWindowDays);
        var lastYear = new PracticeFrequencyDto(daysPracticedYear, YearWindowDays);

        // 30-day breakdown for daily tune history
        var perDay = Enumerable.Range(0, MonthWindowDays)
            .Select(offset =>
            {
                var day = monthStart.AddDays(offset);
                var stats = groupedByDate.GetValueOrDefault(day);
                var totalSessions = stats?.TotalSessions ?? 0;
                var distinctTunes = stats?.DistinctTunes ?? 0;
                return new PracticeDayDto(day.ToString("yyyy-MM-dd"), totalSessions, distinctTunes);
            })
            .ToList();

        var totalLast30 = perDay.Sum(p => p.Count);

        return new PracticeStatsDto(
            CurrentStreakDays: streak,
            TotalLast30: totalLast30,
            PerDay: perDay,
            TunesPracticedToday: tunesPracticedToday,
            AverageTunesPerPracticeDay: averageTunesPerPracticeDay,
            LastWeek: lastWeek,
            LastMonth: lastMonth,
            LastYear: lastYear);
    }
}
