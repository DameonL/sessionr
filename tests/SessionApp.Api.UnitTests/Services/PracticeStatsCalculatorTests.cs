using System;
using System.Collections.Generic;
using System.Linq;
using SessionApp.Api.Services;
using Xunit;

namespace SessionApp.Api.UnitTests.Services;

public class PracticeStatsCalculatorTests
{
    private static readonly DateTime UtcNow = new(2026, 8, 21, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Guid TuneA = Guid.NewGuid();
    private static readonly Guid TuneB = Guid.NewGuid();
    private static readonly Guid TuneC = Guid.NewGuid();

    [Fact]
    public void Calculate_EmptyHistory_ReturnsZeroes()
    {
        var stats = PracticeStatsCalculator.Calculate([], UtcNow);

        Assert.Equal(0, stats.CurrentStreakDays);
        Assert.Equal(0, stats.TotalLast30);
        Assert.Equal(30, stats.PerDay.Count);
        Assert.All(stats.PerDay, p =>
        {
            Assert.Equal(0, p.Count);
            Assert.Equal(0, p.TunesPracticed);
        });
        Assert.Equal(0, stats.TunesPracticedToday);
        Assert.Equal(0.0, stats.AverageTunesPerPracticeDay);
        Assert.Equal(0, stats.LastWeek.PracticedDays);
        Assert.Equal(7, stats.LastWeek.TotalDays);
        Assert.Equal(0, stats.LastMonth.PracticedDays);
        Assert.Equal(30, stats.LastMonth.TotalDays);
        Assert.Equal(0, stats.LastYear.PracticedDays);
        Assert.Equal(365, stats.LastYear.TotalDays);
    }

    [Fact]
    public void Calculate_SinglePracticeToday_ReturnsOne()
    {
        List<PracticeLogItem> entries = [new(TuneA, UtcNow)];

        var stats = PracticeStatsCalculator.Calculate(entries, UtcNow);

        Assert.Equal(1, stats.CurrentStreakDays);
        Assert.Equal(1, stats.TotalLast30);
        Assert.Equal(1, stats.TunesPracticedToday);
        Assert.Equal(1.0, stats.AverageTunesPerPracticeDay);
        Assert.Equal(1, stats.LastWeek.PracticedDays);
        Assert.Equal(1, stats.LastMonth.PracticedDays);
        Assert.Equal(1, stats.LastYear.PracticedDays);

        var todayDto = stats.PerDay.Last();
        Assert.Equal(UtcNow.ToString("yyyy-MM-dd"), todayDto.Date);
        Assert.Equal(1, todayDto.Count);
        Assert.Equal(1, todayDto.TunesPracticed);
    }

    [Fact]
    public void Calculate_SameTuneMultipleTimesInOneDay_CountsOneDistinctTune()
    {
        // Tune A practiced 3 times today
        List<PracticeLogItem> entries =
        [
            new(TuneA, UtcNow.AddHours(-1)),
            new(TuneA, UtcNow.AddHours(-2)),
            new(TuneA, UtcNow)
        ];

        var stats = PracticeStatsCalculator.Calculate(entries, UtcNow);

        Assert.Equal(1, stats.CurrentStreakDays);
        Assert.Equal(3, stats.TotalLast30);
        Assert.Equal(1, stats.TunesPracticedToday);
        Assert.Equal(1.0, stats.AverageTunesPerPracticeDay);

        var todayDto = stats.PerDay.Last();
        Assert.Equal(3, todayDto.Count);
        Assert.Equal(1, todayDto.TunesPracticed);
    }

    [Fact]
    public void Calculate_MultipleDistinctTunesInOneDay_CountsAllDistinctTunes()
    {
        List<PracticeLogItem> entries =
        [
            new(TuneA, UtcNow),
            new(TuneB, UtcNow.AddHours(-1)),
            new(TuneC, UtcNow.AddHours(-2)),
            new(TuneA, UtcNow.AddHours(-3)) // Duplicate of TuneA
        ];

        var stats = PracticeStatsCalculator.Calculate(entries, UtcNow);

        Assert.Equal(1, stats.CurrentStreakDays);
        Assert.Equal(4, stats.TotalLast30);
        Assert.Equal(3, stats.TunesPracticedToday);
        Assert.Equal(3.0, stats.AverageTunesPerPracticeDay);

        var todayDto = stats.PerDay.Last();
        Assert.Equal(4, todayDto.Count);
        Assert.Equal(3, todayDto.TunesPracticed);
    }

    [Fact]
    public void Calculate_AverageTunesPerPracticeDay_AveragesAcrossPracticeDaysOnly()
    {
        // Day 0 (today): TuneA, TuneB, TuneC (3 distinct)
        // Day -1 (yesterday): TuneA (1 distinct)
        // 2 practice days, 4 distinct tune practices => average 2.0
        List<PracticeLogItem> entries =
        [
            new(TuneA, UtcNow),
            new(TuneB, UtcNow.AddHours(-1)),
            new(TuneC, UtcNow.AddHours(-2)),
            new(TuneA, UtcNow.AddDays(-1))
        ];

        var stats = PracticeStatsCalculator.Calculate(entries, UtcNow);

        Assert.Equal(2, stats.CurrentStreakDays);
        Assert.Equal(2, stats.LastWeek.PracticedDays);
        Assert.Equal(2.0, stats.AverageTunesPerPracticeDay);
    }

    [Fact]
    public void Calculate_RollingWindowBoundaries_CategorizesCorrectly()
    {
        List<PracticeLogItem> entries =
        [
            new(TuneA, UtcNow),                   // Day 0: inside week, month, year
            new(TuneA, UtcNow.AddDays(-6)),       // Day -6: 7th day of week -> inside week, month, year
            new(TuneA, UtcNow.AddDays(-7)),       // Day -7: 8th day -> outside week, inside month, year
            new(TuneA, UtcNow.AddDays(-29)),      // Day -29: 30th day -> inside month, year
            new(TuneA, UtcNow.AddDays(-30)),      // Day -30: 31st day -> outside month, inside year
            new(TuneA, UtcNow.AddDays(-364)),     // Day -364: 365th day -> inside year
            new(TuneA, UtcNow.AddDays(-365)),     // Day -365: 366th day -> outside year
        ];

        var stats = PracticeStatsCalculator.Calculate(entries, UtcNow);

        Assert.Equal(2, stats.LastWeek.PracticedDays);
        Assert.Equal(7, stats.LastWeek.TotalDays);

        Assert.Equal(4, stats.LastMonth.PracticedDays);
        Assert.Equal(30, stats.LastMonth.TotalDays);

        Assert.Equal(6, stats.LastYear.PracticedDays);
        Assert.Equal(365, stats.LastYear.TotalDays);
    }

    [Fact]
    public void Calculate_TimezoneOffset_ShiftsLocalCalendarDate()
    {
        // 21 Aug 01:00 UTC at UTC-5 (+300 offset) is 20 Aug 20:00 local time.
        // For the caller at UTC-5, local today is 20 Aug, and this session is today.
        // For UTC, local today is 21 Aug, and 20 Aug is yesterday.
        var utcNow = new DateTime(2026, 8, 21, 1, 0, 0, DateTimeKind.Utc);
        const int utcMinusFive = 300;

        List<PracticeLogItem> entries = [new(TuneA, utcNow)];

        var statsLocal = PracticeStatsCalculator.Calculate(entries, utcNow, utcMinusFive);
        Assert.Equal(1, statsLocal.TunesPracticedToday);
        Assert.Equal("2026-08-20", statsLocal.PerDay.Last().Date);

        var statsUtc = PracticeStatsCalculator.Calculate(entries, utcNow, 0);
        Assert.Equal(1, statsUtc.TunesPracticedToday);
        Assert.Equal("2026-08-21", statsUtc.PerDay.Last().Date);
    }
}
