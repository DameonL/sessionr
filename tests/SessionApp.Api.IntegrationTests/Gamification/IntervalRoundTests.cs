using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Functions;
using SessionApp.Api.IntegrationTests.Infrastructure;
using SessionApp.Api.Models;
using SessionApp.Api.TestSupport;
using IntervalRoundPost = SessionApp.Api.Functions.Users.Me.IntervalRounds.Post;

namespace SessionApp.Api.IntegrationTests.Gamification;

/// <summary>
/// POST /api/users/me/interval-rounds against Cosmos: the daily points cap, retry idempotency, the
/// interval badges, and the stored round counter behind the round-count badges.
///
/// The cap and the retry check are ledger queries (StartsWith / EndsWith on SourceId), and the
/// counter lives on a User document that predates it in production — the shapes most likely to
/// work on SQLite and fail on Cosmos, which is why these run on the emulator.
/// </summary>
public class IntervalRoundTests(CosmosEmulatorFixture fixture) : CosmosTestBase(fixture)
{
    private Task<IActionResult> PostRound(
        Guid userId, int questionCount = 10, int correctCount = 5, string answerMode = "name",
        Guid? roundId = null, int timezoneOffsetMinutes = 0) =>
        InvokeAsync<IntervalRoundPost, IActionResult>(fn => fn.RecordIntervalRound(TestRequest.For(
            userId,
            body: new RecordIntervalRoundRequest(roundId ?? Guid.CreateVersion7(), questionCount, correctCount, answerMode),
            timezoneOffsetMinutes: timezoneOffsetMinutes)));

    private Task<int> RoundsCompleted(Guid userId) =>
        Fixture.WithDbAsync(async db => (await db.Users.AsNoTracking().SingleAsync(u => u.UserId == userId)).IntervalRoundsCompleted);

    [Fact]
    public async Task FirstRound_ScoresAndEarnsTheFirstRoundBadge()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var result = Ok<RecordIntervalRoundResponseDto>(await PostRound(user.UserId, correctCount: 9));

        Assert.Equal(5, result.PointsAwarded);
        Assert.False(result.DailyCapReached);
        Assert.Equal(["interval-first"], result.NewBadges);
        Assert.Equal(1, await RoundsCompleted(user.UserId));
    }

    [Fact]
    public async Task RetriedRound_IsRecordedOnce()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var roundId = Guid.CreateVersion7();

        var first = Ok<RecordIntervalRoundResponseDto>(await PostRound(user.UserId, roundId: roundId));
        var retry = Ok<RecordIntervalRoundResponseDto>(await PostRound(user.UserId, roundId: roundId));

        Assert.Equal(5, first.PointsAwarded);
        Assert.Equal(0, retry.PointsAwarded);
        Assert.Empty(retry.NewBadges);
        Assert.Equal(1, await RoundsCompleted(user.UserId));
    }

    /// <summary>A retry that lands after local midnight carries a new date, so the check matches on the round id alone.</summary>
    [Fact]
    public async Task RetriedRound_AcrossLocalMidnight_IsStillRecognised()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var roundId = Guid.CreateVersion7();

        await PostRound(user.UserId, roundId: roundId);
        var nextDay = Ok<RecordIntervalRoundResponseDto>(
            await PostRound(user.UserId, roundId: roundId, timezoneOffsetMinutes: -24 * 60));

        Assert.Equal(0, nextDay.PointsAwarded);
        Assert.Equal(1, await RoundsCompleted(user.UserId));
    }

    [Fact]
    public async Task RoundsPastTheDailyCap_ScoreNothingButStillCount()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var scored = new List<int>();
        for (var i = 0; i < 3; i++)
        {
            scored.Add(Ok<RecordIntervalRoundResponseDto>(await PostRound(user.UserId)).PointsAwarded);
        }
        var capped = Ok<RecordIntervalRoundResponseDto>(await PostRound(user.UserId));

        Assert.Equal([5, 5, 5], scored);
        Assert.Equal(0, capped.PointsAwarded);
        Assert.True(capped.DailyCapReached);
        Assert.Equal(4, await RoundsCompleted(user.UserId));

        var ledger = await Fixture.WithDbAsync(db => db.PointsTransactions.AsNoTracking()
            .Where(t => t.UserId == user.UserId).ToListAsync());
        Assert.Equal(15, ledger.Sum(t => t.Points));
    }

    [Fact]
    public async Task TheCap_ResetsOnTheNextLocalDay()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        for (var i = 0; i < 3; i++) await PostRound(user.UserId);

        var tomorrow = Ok<RecordIntervalRoundResponseDto>(await PostRound(user.UserId, timezoneOffsetMinutes: -24 * 60));

        Assert.Equal(5, tomorrow.PointsAwarded);
    }

    [Fact]
    public async Task PerfectRounds_EarnTheirBadges_ByNamingAndByPlaying()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var named = Ok<RecordIntervalRoundResponseDto>(await PostRound(user.UserId, 10, 10, "name"));
        var played = Ok<RecordIntervalRoundResponseDto>(await PostRound(user.UserId, 10, 10, "play"));

        Assert.Equal(["interval-first", "interval-perfect"], named.NewBadges);
        Assert.Equal(["interval-perfect-play"], played.NewBadges);
    }

    /// <summary>Five lucky guesses shouldn't count as a perfect round.</summary>
    [Fact]
    public async Task ShortPerfectRound_IsNotPerfect()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var result = Ok<RecordIntervalRoundResponseDto>(await PostRound(user.UserId, 5, 5, "play"));

        Assert.Equal(["interval-first"], result.NewBadges);
    }

    /// <summary>The milestone reads the stored counter, not the ledger: this user has no rounds in it at all.</summary>
    [Fact]
    public async Task RoundMilestone_ComesFromTheStoredCounter()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(async db =>
        {
            var stored = await db.Users.SingleAsync(u => u.UserId == user.UserId);
            stored.IntervalRoundsCompleted = 9;
            await db.SaveChangesAsync();
        });

        var result = Ok<RecordIntervalRoundResponseDto>(await PostRound(user.UserId));

        Assert.Contains("interval-rounds-10", result.NewBadges);
        Assert.DoesNotContain("interval-rounds-50", result.NewBadges);
        Assert.Equal(10, await RoundsCompleted(user.UserId));
    }

    /// <summary>
    /// Every production user document predates the counter. Cosmos is schemaless, so the field is
    /// simply absent; loading the whole entity reads that as 0, where projecting it would throw.
    /// </summary>
    [Fact]
    public async Task UserStoredBeforeTheCounterExisted_StartsFromZero()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        await Fixture.StripPropertiesAsync(nameof(User), user.UserId, nameof(User.IntervalRoundsCompleted));

        var result = Ok<RecordIntervalRoundResponseDto>(await PostRound(user.UserId));

        Assert.Equal(5, result.PointsAwarded);
        Assert.Equal(1, await RoundsCompleted(user.UserId));
    }

    [Fact]
    public async Task SignedOut_IsRefused()
    {
        var result = await InvokeAsync<IntervalRoundPost, IActionResult>(fn => fn.RecordIntervalRound(TestRequest.Anonymous(
            body: new RecordIntervalRoundRequest(Guid.CreateVersion7(), 10, 5, "name"))));

        AssertStatus(401, result);
    }

    [Theory]
    [InlineData(4, 4, "name")]   // shorter than the shortest round the trainer offers
    [InlineData(10, 11, "name")] // more right than asked
    [InlineData(10, 5, "sing")]  // not an answer mode
    public async Task InvalidRounds_AreRejected(int questionCount, int correctCount, string answerMode)
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var result = await PostRound(user.UserId, questionCount, correctCount, answerMode);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, await RoundsCompleted(user.UserId));
    }
}
