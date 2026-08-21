using SessionApp.Api.Services;

namespace SessionApp.Api.UnitTests.Services;

public class PracticeStreakCalculatorTests
{
    private static readonly DateTime UtcNow = new(2026, 8, 21, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void ComputeCurrentStreak_NoHistory_IsZero()
    {
        Assert.Equal(0, PracticeStreakCalculator.ComputeCurrentStreak([], UtcNow));
    }

    [Fact]
    public void ComputeCurrentStreak_CountsConsecutiveDaysEndingToday()
    {
        DateTime[] practiced = [UtcNow, UtcNow.AddDays(-1), UtcNow.AddDays(-2)];

        Assert.Equal(3, PracticeStreakCalculator.ComputeCurrentStreak(practiced, UtcNow));
    }

    [Fact]
    public void ComputeCurrentStreak_SurvivesADayNotYetPracticed()
    {
        // Nothing logged today yet, but yesterday and the day before are covered:
        // the streak doesn't break until the local day is fully over.
        DateTime[] practiced = [UtcNow.AddDays(-1), UtcNow.AddDays(-2)];

        Assert.Equal(2, PracticeStreakCalculator.ComputeCurrentStreak(practiced, UtcNow));
    }

    [Fact]
    public void ComputeCurrentStreak_BreaksOnAFullMissedDay()
    {
        // The most recent entry is two days back — that day is fully over.
        DateTime[] practiced = [UtcNow.AddDays(-2), UtcNow.AddDays(-3)];

        Assert.Equal(0, PracticeStreakCalculator.ComputeCurrentStreak(practiced, UtcNow));
    }

    [Fact]
    public void ComputeCurrentStreak_StopsAtTheFirstGap()
    {
        DateTime[] practiced =
        [
            UtcNow, UtcNow.AddDays(-1),
            /* gap on day -2 */
            UtcNow.AddDays(-3), UtcNow.AddDays(-4),
        ];

        Assert.Equal(2, PracticeStreakCalculator.ComputeCurrentStreak(practiced, UtcNow));
    }

    [Fact]
    public void ComputeCurrentStreak_CountsEachCalendarDayOnce()
    {
        DateTime[] practiced =
        [
            UtcNow, UtcNow.AddHours(-1), UtcNow.AddHours(-2), // three sessions, one day
            UtcNow.AddDays(-1),
        ];

        Assert.Equal(2, PracticeStreakCalculator.ComputeCurrentStreak(practiced, UtcNow));
    }

    // offsetMinutes carries the browser's Date.getTimezoneOffset(), which is *positive*
    // west of UTC — so UTC-5 arrives as +300. The calculator subtracts it to get local time.
    private const int UtcMinusFive = 300;

    [Fact]
    public void ComputeCurrentStreak_OffsetCanMergeTwoUtcDaysIntoOneLocalDay()
    {
        // 20 Aug 23:00 and 21 Aug 01:00 UTC are two UTC days, but at UTC-5 both fall
        // on the evening of the 20th — one local day, so one day of streak.
        var utcNow = new DateTime(2026, 8, 21, 1, 0, 0, DateTimeKind.Utc);
        DateTime[] practiced = [utcNow, new DateTime(2026, 8, 20, 23, 0, 0, DateTimeKind.Utc)];

        Assert.Equal(1, PracticeStreakCalculator.ComputeCurrentStreak(practiced, utcNow, UtcMinusFive));
        Assert.Equal(2, PracticeStreakCalculator.ComputeCurrentStreak(practiced, utcNow));
    }

    [Fact]
    public void ComputeCurrentStreak_OffsetCanKeepAStreakAliveThatUtcWouldHaveBroken()
    {
        // Practised 19 Aug 23:00 UTC, now 21 Aug 01:00 UTC.
        //   In UTC:   local today is the 21st, so the anchor is the 20th — nothing there, streak broken.
        //   At UTC-5: local today is the 20th, the anchor falls back to the 19th — where the session is.
        var utcNow = new DateTime(2026, 8, 21, 1, 0, 0, DateTimeKind.Utc);
        DateTime[] practiced = [new DateTime(2026, 8, 19, 23, 0, 0, DateTimeKind.Utc)];

        Assert.Equal(1, PracticeStreakCalculator.ComputeCurrentStreak(practiced, utcNow, UtcMinusFive));
        Assert.Equal(0, PracticeStreakCalculator.ComputeCurrentStreak(practiced, utcNow));
    }

    [Fact]
    public void EffectiveStreak_NoAnchor_IsZero()
    {
        Assert.Equal(0, PracticeStreakCalculator.EffectiveStreak(42, null, UtcNow));
    }

    [Theory]
    [InlineData(0, 12)]   // anchored today — alive
    [InlineData(-1, 12)]  // anchored yesterday — still alive, the day isn't over
    [InlineData(-2, 0)]   // a full local day passed without practice — broken
    [InlineData(-10, 0)]
    public void EffectiveStreak_ExpiresOnceAFullLocalDayPasses(int anchorDaysAgo, int expected)
    {
        var anchor = UtcNow.AddDays(anchorDaysAgo).Date;

        Assert.Equal(expected, PracticeStreakCalculator.EffectiveStreak(12, anchor, UtcNow));
    }

    [Fact]
    public void EffectiveStreak_AnchorsAgainstTheCallersLocalToday()
    {
        // 01:00 UTC on the 21st is still the 20th at UTC-5, so an anchor on the 19th
        // is "yesterday" locally (alive) but two days back in UTC (expired).
        var utcNow = new DateTime(2026, 8, 21, 1, 0, 0, DateTimeKind.Utc);
        var anchor = new DateTime(2026, 8, 19);

        Assert.Equal(9, PracticeStreakCalculator.EffectiveStreak(9, anchor, utcNow, UtcMinusFive));
        Assert.Equal(0, PracticeStreakCalculator.EffectiveStreak(9, anchor, utcNow));
    }

    [Fact]
    public void EffectiveStreak_AgreesWithComputeCurrentStreakOnALiveStreak()
    {
        DateTime[] practiced = [UtcNow, UtcNow.AddDays(-1), UtcNow.AddDays(-2)];
        var computed = PracticeStreakCalculator.ComputeCurrentStreak(practiced, UtcNow);

        Assert.Equal(computed, PracticeStreakCalculator.EffectiveStreak(computed, UtcNow.Date, UtcNow));
    }
}
