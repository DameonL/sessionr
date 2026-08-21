using Microsoft.AspNetCore.Mvc;
using SessionApp.Api.Functions;
using SessionApp.Api.IntegrationTests.Infrastructure;
using SessionApp.Api.Models;
using SessionApp.Api.TestSupport;
using QueueGet = SessionApp.Api.Functions.Practice.Queue.Get;

namespace SessionApp.Api.IntegrationTests.Practice;

/// <summary>
/// The practice queue is the app's most demanding single query on Cosmos: a multi-clause
/// <c>Where</c> mixing an enum comparison, a nullable <c>DateTime</c> comparison and an
/// <c>||</c>, followed by a <c>.Select</c> projection — a shape Cosmos translates quite
/// differently from SQLite — and then a second stitched read for the selected tunes.
/// </summary>
public class PracticeQueueTests(CosmosEmulatorFixture fixture) : CosmosTestBase(fixture)
{
    private static readonly TimeSpan JustOverTheCooldown = TimeSpan.FromHours(13);

    private Task<List<PracticeQueueItemDto>> QueueForAsync(Guid userId) =>
        InvokeAsync<QueueGet, IActionResult>(f => f.GetPracticeQueue(TestRequest.For(userId)))
            .ContinueWith(t => Ok<List<PracticeQueueItemDto>>(t.Result));

    [Fact]
    public async Task RejectsAnUnauthenticatedCaller()
    {
        var result = await InvokeAsync<QueueGet, IActionResult>(f =>
            f.GetPracticeQueue(TestRequest.Anonymous()));

        AssertStatus(401, result);
    }

    [Fact]
    public async Task ANewUsersQueueIsEmpty()
    {
        Assert.Empty(await QueueForAsync(TestData.NewId()));
    }

    [Fact]
    public async Task IncludesLearningTunes()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Half Learned"));
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune, TuneStatus.Learning));

        var item = Assert.Single(await QueueForAsync(user.UserId));
        Assert.Equal("Half Learned", item.Title);
        Assert.Equal("Actively learning", item.Reason);
    }

    [Fact]
    public async Task ExcludesWishlistAndRetiredTunes()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var wishlist = await SeedAsync(db => db.SeedTuneAsync("Someday"));
        var retired = await SeedAsync(db => db.SeedTuneAsync("Put Away"));
        await SeedAsync(db => db.SeedUserTuneAsync(user, wishlist, TuneStatus.Wishlist));
        await SeedAsync(db => db.SeedUserTuneAsync(user, retired, TuneStatus.Retired));

        Assert.Empty(await QueueForAsync(user.UserId));
    }

    [Fact]
    public async Task ExcludesATuneStillInsideItsPracticeCooldown()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Just Played"));
        await SeedAsync(db => db.SeedUserTuneAsync(
            user, tune, TuneStatus.Learning, lastPracticed: DateTime.UtcNow.AddHours(-1)));

        Assert.Empty(await QueueForAsync(user.UserId));
    }

    [Fact]
    public async Task IncludesATuneOnceTheCooldownHasPassed()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooled Down"));
        await SeedAsync(db => db.SeedUserTuneAsync(
            user, tune, TuneStatus.Learning, lastPracticed: DateTime.UtcNow - JustOverTheCooldown));

        Assert.Single(await QueueForAsync(user.UserId));
    }

    [Fact]
    public async Task AnActiveTuneNeverPractisedIsTreatedAsRusty()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Never Logged"));
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune, TuneStatus.Active));

        var item = Assert.Single(await QueueForAsync(user.UserId));
        Assert.Equal("Active tune never logged", item.Reason);
    }

    [Fact]
    public async Task AnActiveTuneUnplayedForAMonthIsRusty()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Gathering Dust"));
        await SeedAsync(db => db.SeedUserTuneAsync(
            user, tune, TuneStatus.Active, lastPracticed: DateTime.UtcNow.AddDays(-45)));

        var item = Assert.Single(await QueueForAsync(user.UserId));
        Assert.Equal("Unplayed for 45 days", item.Reason);
    }

    [Fact]
    public async Task AnActiveTunePlayedRecentlyIsMaintenance()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Ticking Over"));
        await SeedAsync(db => db.SeedUserTuneAsync(
            user, tune, TuneStatus.Active, lastPracticed: DateTime.UtcNow.AddDays(-5)));

        var item = Assert.Single(await QueueForAsync(user.UserId));
        Assert.Equal("Practiced 5 days ago", item.Reason);
    }

    [Fact]
    public async Task ARustyTuneReportsHowLongItHasBeen()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Marked Rusty"));
        await SeedAsync(db => db.SeedUserTuneAsync(
            user, tune, TuneStatus.Rusty, lastPracticed: DateTime.UtcNow.AddDays(-10)));

        var item = Assert.Single(await QueueForAsync(user.UserId));
        Assert.Equal("Not practiced in 10 days", item.Reason);
    }

    [Fact]
    public async Task ARustyTuneNeverPractisedSaysSo()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Rusty From The Start"));
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune, TuneStatus.Rusty));

        Assert.Equal("Marked as rusty", Assert.Single(await QueueForAsync(user.UserId)).Reason);
    }

    [Fact]
    public async Task LearningComesFirstThenRustyThenMaintenance()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var maintenance = await SeedAsync(db => db.SeedTuneAsync("Maintenance"));
        await SeedAsync(db => db.SeedUserTuneAsync(
            user, maintenance, TuneStatus.Active, lastPracticed: DateTime.UtcNow.AddDays(-3)));

        var rusty = await SeedAsync(db => db.SeedTuneAsync("Rusty"));
        await SeedAsync(db => db.SeedUserTuneAsync(
            user, rusty, TuneStatus.Rusty, lastPracticed: DateTime.UtcNow.AddDays(-20)));

        var learning = await SeedAsync(db => db.SeedTuneAsync("Learning"));
        await SeedAsync(db => db.SeedUserTuneAsync(user, learning, TuneStatus.Learning));

        Assert.Equal(["Learning", "Rusty", "Maintenance"], (await QueueForAsync(user.UserId)).Select(i => i.Title));
    }

    [Fact]
    public async Task TheStalestTuneComesFirstWithinACategory()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var recent = await SeedAsync(db => db.SeedTuneAsync("Recent"));
        var stale = await SeedAsync(db => db.SeedTuneAsync("Stale"));
        await SeedAsync(db => db.SeedUserTuneAsync(
            user, recent, TuneStatus.Rusty, lastPracticed: DateTime.UtcNow.AddDays(-10)));
        await SeedAsync(db => db.SeedUserTuneAsync(
            user, stale, TuneStatus.Rusty, lastPracticed: DateTime.UtcNow.AddDays(-90)));

        Assert.Equal(["Stale", "Recent"], (await QueueForAsync(user.UserId)).Select(i => i.Title));
    }

    [Fact]
    public async Task CapsTheQueueAtEightTunes()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        for (var i = 0; i < 12; i++)
        {
            var tune = await SeedAsync(db => db.SeedTuneAsync($"Queued {i:D2}"));
            await SeedAsync(db => db.SeedUserTuneAsync(user, tune, TuneStatus.Learning));
        }

        Assert.Equal(8, (await QueueForAsync(user.UserId)).Count);
    }

    [Fact]
    public async Task CarriesTheStitchedTuneMetadataAndAbc()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("The Butterfly", TuneType.SlipJig, "Em"));
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune, TuneStatus.Learning));

        var item = Assert.Single(await QueueForAsync(user.UserId));
        Assert.Equal("The Butterfly", item.Title);
        Assert.Equal("SlipJig", item.TuneType);
        Assert.Equal("Em", item.Key);
        Assert.Equal(tune.MasterAbcText, item.AbcText);
        Assert.Equal(Tune.GetDefaultTargetBpm(TuneType.SlipJig), item.TargetBpm);
    }

    [Fact]
    public async Task PrefersThePinnedSettingsAbcOverTheMaster()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        var setting = await SeedAsync(db => db.SeedTuneSettingAsync(tune, TestData.DrowsyMaggieAbc, "Ador"));
        await SeedAsync(db => db.SeedUserTuneAsync(
            user, tune, TuneStatus.Learning, tuneSettingId: setting.TuneSettingId));

        var item = Assert.Single(await QueueForAsync(user.UserId));
        Assert.Equal(TestData.DrowsyMaggieAbc, item.AbcText);
        Assert.Equal("Ador", item.Key);
    }

    [Fact]
    public async Task PrefersTheUsersOwnCustomAbcOverEverything()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        var setting = await SeedAsync(db => db.SeedTuneSettingAsync(tune, TestData.DrowsyMaggieAbc));
        const string mine = "K:Edor\nEBBA|dBAG:|";
        await SeedAsync(db => db.SeedUserTuneAsync(
            user, tune, TuneStatus.Learning, tuneSettingId: setting.TuneSettingId, customAbcText: mine));

        Assert.Equal(mine, Assert.Single(await QueueForAsync(user.UserId)).AbcText);
    }

    [Fact]
    public async Task DoesNotQueueAnotherUsersTunes()
    {
        var mine = await SeedAsync(db => db.SeedUserAsync());
        var theirs = await SeedAsync(db => db.SeedUserAsync());
        var myTune = await SeedAsync(db => db.SeedTuneAsync("Mine"));
        var theirTune = await SeedAsync(db => db.SeedTuneAsync("Theirs"));
        await SeedAsync(db => db.SeedUserTuneAsync(mine, myTune, TuneStatus.Learning));
        await SeedAsync(db => db.SeedUserTuneAsync(theirs, theirTune, TuneStatus.Learning));

        Assert.Equal("Mine", Assert.Single(await QueueForAsync(mine.UserId)).Title);
    }
}
