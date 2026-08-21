using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Functions;
using SessionApp.Api.IntegrationTests.Infrastructure;
using SessionApp.Api.Models;
using SessionApp.Api.TestSupport;
using RepertoireGet = SessionApp.Api.Functions.Repertoire.Get;
using RepertoirePost = SessionApp.Api.Functions.Repertoire.Post;

namespace SessionApp.Api.IntegrationTests.Repertoire;

/// <summary>
/// GET/POST /api/repertoire against real Cosmos. This is the app's busiest read path and the one
/// most exposed to the Cosmos model: only <c>Status</c> can be filtered server-side, while search,
/// type and ordering all depend on the referenced Tune — a separate document that has to be
/// stitched in by id first.
/// </summary>
public class RepertoireEndpointTests(CosmosEmulatorFixture fixture) : CosmosTestBase(fixture)
{
    [Fact]
    public async Task Get_RejectsAnUnauthenticatedCaller()
    {
        var result = await InvokeAsync<RepertoireGet, IActionResult>(f => f.GetRepertoire(TestRequest.Anonymous()));

        AssertStatus(401, result);
    }

    [Fact]
    public async Task Get_ANewUsersRepertoireIsEmpty()
    {
        var userId = TestData.NewId();

        var result = await InvokeAsync<RepertoireGet, IActionResult>(f =>
            f.GetRepertoire(TestRequest.For(userId, TestData.NewEmail(), "Newcomer")));

        var page = Ok<PagedResult<RepertoireItemDto>>(result);
        Assert.Empty(page.Items);
        Assert.Equal(0, page.TotalCount);
    }

    [Fact]
    public async Task Get_StitchesEachEntrysTuneMetadataFromItsOwnDocument()
    {
        // The whole point of the Cosmos path: UserTune and Tune are separate documents with no
        // navigation between them, so Title/Key/Type here can only come from an id-based stitch.
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("The Butterfly", TuneType.SlipJig, "Em"));
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune, TuneStatus.Active));

        var result = await InvokeAsync<RepertoireGet, IActionResult>(f =>
            f.GetRepertoire(TestRequest.For(user.UserId)));

        var item = Assert.Single(Ok<PagedResult<RepertoireItemDto>>(result).Items);
        Assert.Equal("The Butterfly", item.Title);
        Assert.Equal("SlipJig", item.TuneType);
        Assert.Equal("Em", item.Key);
        Assert.Equal(tune.MasterAbcText, item.AbcText);
    }

    [Fact]
    public async Task Get_ReturnsOnlyTheCallersOwnEntries()
    {
        var mine = await SeedAsync(db => db.SeedUserAsync());
        var theirs = await SeedAsync(db => db.SeedUserAsync());
        var myTune = await SeedAsync(db => db.SeedTuneAsync("Mine"));
        var theirTune = await SeedAsync(db => db.SeedTuneAsync("Theirs"));
        await SeedAsync(db => db.SeedUserTuneAsync(mine, myTune));
        await SeedAsync(db => db.SeedUserTuneAsync(theirs, theirTune));

        var result = await InvokeAsync<RepertoireGet, IActionResult>(f =>
            f.GetRepertoire(TestRequest.For(mine.UserId)));

        var item = Assert.Single(Ok<PagedResult<RepertoireItemDto>>(result).Items);
        Assert.Equal("Mine", item.Title);
    }

    [Fact]
    public async Task Get_FiltersByStatusServerSide()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var active = await SeedAsync(db => db.SeedTuneAsync("Active One"));
        var learning = await SeedAsync(db => db.SeedTuneAsync("Learning One"));
        await SeedAsync(db => db.SeedUserTuneAsync(user, active, TuneStatus.Active));
        await SeedAsync(db => db.SeedUserTuneAsync(user, learning, TuneStatus.Learning));

        var result = await InvokeAsync<RepertoireGet, IActionResult>(f => f.GetRepertoire(
            TestRequest.For(user.UserId, query: new Dictionary<string, string> { ["status"] = "Learning" })));

        var item = Assert.Single(Ok<PagedResult<RepertoireItemDto>>(result).Items);
        Assert.Equal("Learning One", item.Title);
    }

    [Fact]
    public async Task Get_FiltersByTitleSearchAfterStitching()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        foreach (var title in new[] { "Cooley's", "Drowsy Maggie", "The Maid Behind the Bar" })
        {
            var tune = await SeedAsync(db => db.SeedTuneAsync(title));
            await SeedAsync(db => db.SeedUserTuneAsync(user, tune));
        }

        var result = await InvokeAsync<RepertoireGet, IActionResult>(f => f.GetRepertoire(
            TestRequest.For(user.UserId, query: new Dictionary<string, string> { ["search"] = "maggie" })));

        var item = Assert.Single(Ok<PagedResult<RepertoireItemDto>>(result).Items);
        Assert.Equal("Drowsy Maggie", item.Title);
    }

    [Fact]
    public async Task Get_FiltersByTuneTypeAfterStitching()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var reel = await SeedAsync(db => db.SeedTuneAsync("A Reel", TuneType.Reel));
        var jig = await SeedAsync(db => db.SeedTuneAsync("A Jig", TuneType.Jig));
        await SeedAsync(db => db.SeedUserTuneAsync(user, reel));
        await SeedAsync(db => db.SeedUserTuneAsync(user, jig));

        var result = await InvokeAsync<RepertoireGet, IActionResult>(f => f.GetRepertoire(
            TestRequest.For(user.UserId, query: new Dictionary<string, string> { ["type"] = "Jig" })));

        var item = Assert.Single(Ok<PagedResult<RepertoireItemDto>>(result).Items);
        Assert.Equal("A Jig", item.Title);
    }

    [Fact]
    public async Task Get_SortsByTitleIgnoringALeadingArticle()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        foreach (var title in new[] { "The Butterfly", "A Fig for a Kiss", "Cooley's" })
        {
            var tune = await SeedAsync(db => db.SeedTuneAsync(title));
            await SeedAsync(db => db.SeedUserTuneAsync(user, tune));
        }

        var result = await InvokeAsync<RepertoireGet, IActionResult>(f =>
            f.GetRepertoire(TestRequest.For(user.UserId)));

        // Filed under B, C, F — not A, C, T.
        Assert.Equal(
            ["The Butterfly", "Cooley's", "A Fig for a Kiss"],
            Ok<PagedResult<RepertoireItemDto>>(result).Items.Select(i => i.Title));
    }

    [Fact]
    public async Task Get_PagesTheResults()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        for (var i = 0; i < 5; i++)
        {
            var tune = await SeedAsync(db => db.SeedTuneAsync($"Tune {i:D2}"));
            await SeedAsync(db => db.SeedUserTuneAsync(user, tune));
        }

        var firstPage = Ok<PagedResult<RepertoireItemDto>>(await InvokeAsync<RepertoireGet, IActionResult>(f =>
            f.GetRepertoire(TestRequest.For(user.UserId, query: new Dictionary<string, string>
            {
                ["page"] = "1",
                ["pageSize"] = "2",
            }))));

        Assert.Equal(2, firstPage.Items.Count);
        Assert.Equal(5, firstPage.TotalCount);
        Assert.True(firstPage.HasMore);
        Assert.Equal(["Tune 00", "Tune 01"], firstPage.Items.Select(i => i.Title));

        var lastPage = Ok<PagedResult<RepertoireItemDto>>(await InvokeAsync<RepertoireGet, IActionResult>(f =>
            f.GetRepertoire(TestRequest.For(user.UserId, query: new Dictionary<string, string>
            {
                ["page"] = "3",
                ["pageSize"] = "2",
            }))));

        Assert.Single(lastPage.Items);
        Assert.False(lastPage.HasMore);
    }

    [Fact]
    public async Task Get_SummaryModeOmitsTheAbcPayload()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune));

        var result = await InvokeAsync<RepertoireGet, IActionResult>(f => f.GetRepertoire(
            TestRequest.For(user.UserId, query: new Dictionary<string, string> { ["summary"] = "true" })));

        var item = Assert.Single(Ok<PagedResult<RepertoireListItemDto>>(result).Items);
        Assert.Equal("Cooley's", item.Title);
        Assert.Equal(tune.Difficulty, item.Difficulty);
    }

    [Fact]
    public async Task Get_ReportsThePinnedSettingsKeyAndAbcRatherThanTheTunes()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's", key: "Edor"));
        var setting = await SeedAsync(db => db.SeedTuneSettingAsync(tune, TestData.DrowsyMaggieAbc, "Ador", "Fiddler"));
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune, tuneSettingId: setting.TuneSettingId));

        var result = await InvokeAsync<RepertoireGet, IActionResult>(f =>
            f.GetRepertoire(TestRequest.For(user.UserId)));

        var item = Assert.Single(Ok<PagedResult<RepertoireItemDto>>(result).Items);
        Assert.Equal("Ador", item.Key);
        Assert.Equal(TestData.DrowsyMaggieAbc, item.AbcText);
        Assert.Equal(setting.TuneSettingId, item.TuneSettingId);
        Assert.True(item.IsPinnedSetting);
    }

    [Fact]
    public async Task Get_FallsBackToTheTopVotedSettingWhenTheEntryIsUnpinned()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        await SeedAsync(db => db.SeedTuneSettingAsync(tune, TestData.CooleysAbc, voteScore: 1, submitterName: "Quiet"));
        var popular = await SeedAsync(db => db.SeedTuneSettingAsync(tune, TestData.BankOfIrelandAbc, "G", "Popular", voteScore: 9));
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune));

        var result = await InvokeAsync<RepertoireGet, IActionResult>(f =>
            f.GetRepertoire(TestRequest.For(user.UserId)));

        var item = Assert.Single(Ok<PagedResult<RepertoireItemDto>>(result).Items);
        Assert.Equal(popular.TuneSettingId, item.TuneSettingId);
        Assert.False(item.IsPinnedSetting); // resolved from votes, not chosen by the user
    }

    [Fact]
    public async Task Get_PrefersTheUsersOwnCustomAbcOverEverything()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        var setting = await SeedAsync(db => db.SeedTuneSettingAsync(tune, TestData.BankOfIrelandAbc, voteScore: 9));
        const string mine = "K:Edor\nEBBA|dBAG:|";
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune, tuneSettingId: setting.TuneSettingId, customAbcText: mine));

        var result = await InvokeAsync<RepertoireGet, IActionResult>(f =>
            f.GetRepertoire(TestRequest.For(user.UserId)));

        var item = Assert.Single(Ok<PagedResult<RepertoireItemDto>>(result).Items);
        Assert.Equal(mine, item.AbcText);
        Assert.True(item.HasCustomAbc);
    }

    // --- POST ---

    [Fact]
    public async Task Post_RejectsAnUnauthenticatedCaller()
    {
        var tune = await SeedAsync(db => db.SeedTuneAsync());

        var result = await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.Anonymous(new AddToRepertoireRequest(tune.TuneId))));

        AssertStatus(401, result);
    }

    [Fact]
    public async Task Post_AddsATuneAndReturnsTheNewEntry()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's", TuneType.Reel, "Edor"));

        var result = await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(user.UserId, body: new AddToRepertoireRequest(tune.TuneId))));

        var item = Ok<RepertoireItemDto>(result);
        Assert.Equal(tune.TuneId, item.TuneId);
        Assert.Equal("Cooley's", item.Title);
        Assert.Equal(nameof(TuneStatus.Learning), item.Status);
        Assert.Equal(Tune.GetDefaultTargetBpm(TuneType.Reel), item.TargetBpm);

        var persisted = await Fixture.WithDbAsync(db => db.UserTunes.AsNoTracking()
            .Where(ut => ut.UserId == user.UserId).ToListAsync());
        Assert.Single(persisted);
    }

    [Fact]
    public async Task Post_IncrementsTheTunesRepertoireCount()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Popular"));

        await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(user.UserId, body: new AddToRepertoireRequest(tune.TuneId))));

        var reloaded = await Fixture.WithDbAsync(db =>
            db.Tunes.AsNoTracking().SingleAsync(t => t.TuneId == tune.TuneId));
        Assert.Equal(tune.RepertoireCount + 1, reloaded.RepertoireCount);
    }

    [Fact]
    public async Task Post_RefusesTheSameTuneTwice()
    {
        // The duplicate guard is a projected LIMIT-1 read, not AnyAsync — Cosmos has no unique
        // index to fall back on, so this check *is* the constraint.
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync());

        await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(user.UserId, body: new AddToRepertoireRequest(tune.TuneId))));

        var second = await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(user.UserId, body: new AddToRepertoireRequest(tune.TuneId))));

        AssertStatus(409, second);

        var persisted = await Fixture.WithDbAsync(db => db.UserTunes.AsNoTracking()
            .Where(ut => ut.UserId == user.UserId).ToListAsync());
        Assert.Single(persisted);
    }

    [Fact]
    public async Task Post_TwoUsersMayHoldTheSameTune()
    {
        var first = await SeedAsync(db => db.SeedUserAsync());
        var second = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync());

        var a = await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(first.UserId, body: new AddToRepertoireRequest(tune.TuneId))));
        var b = await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(second.UserId, body: new AddToRepertoireRequest(tune.TuneId))));

        Ok<RepertoireItemDto>(a);
        Ok<RepertoireItemDto>(b);
    }

    [Fact]
    public async Task Post_PinsTheTopVotedSettingWhenTheCallerDoesNotChooseOne()
    {
        // Pinned at add time on purpose: later votes by other users must not silently change
        // the notes under an existing repertoire entry.
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync());
        await SeedAsync(db => db.SeedTuneSettingAsync(tune, TestData.CooleysAbc, voteScore: 2));
        var popular = await SeedAsync(db => db.SeedTuneSettingAsync(tune, TestData.DrowsyMaggieAbc, voteScore: 7));

        var result = await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(user.UserId, body: new AddToRepertoireRequest(tune.TuneId))));

        var item = Ok<RepertoireItemDto>(result);
        Assert.Equal(popular.TuneSettingId, item.TuneSettingId);
        Assert.True(item.IsPinnedSetting);
    }

    [Fact]
    public async Task Post_HonoursAnExplicitlyChosenSetting()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync());
        var chosen = await SeedAsync(db => db.SeedTuneSettingAsync(tune, TestData.CooleysAbc, voteScore: 1));
        await SeedAsync(db => db.SeedTuneSettingAsync(tune, TestData.DrowsyMaggieAbc, voteScore: 99));

        var result = await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(user.UserId, body: new AddToRepertoireRequest(tune.TuneId, chosen.TuneSettingId))));

        Assert.Equal(chosen.TuneSettingId, Ok<RepertoireItemDto>(result).TuneSettingId);
    }

    [Fact]
    public async Task Post_RejectsASettingBelongingToADifferentTune()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Wanted"));
        var otherTune = await SeedAsync(db => db.SeedTuneAsync("Unrelated"));
        var foreignSetting = await SeedAsync(db => db.SeedTuneSettingAsync(otherTune));

        var result = await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(user.UserId, body: new AddToRepertoireRequest(tune.TuneId, foreignSetting.TuneSettingId))));

        AssertStatus(400, result);
    }

    [Fact]
    public async Task Post_RejectsAnUnknownTune()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(user.UserId, body: new AddToRepertoireRequest(TestData.NewId()))));

        AssertStatus(404, result);
    }

    [Fact]
    public async Task Post_RejectsAMissingTuneId()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(user.UserId, body: new AddToRepertoireRequest(Guid.Empty))));

        AssertStatus(400, result);
    }

    [Fact]
    public async Task Post_RejectsAMalformedBody()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(user.UserId, body: "{ not json")));

        AssertStatus(400, result);
    }

    [Fact]
    public async Task PostThenGet_TheAddedTuneShowsUpInTheListing()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Round Tripped"));

        await InvokeAsync<RepertoirePost, IActionResult>(f => f.AddToRepertoire(
            TestRequest.For(user.UserId, body: new AddToRepertoireRequest(tune.TuneId))));

        var listed = await InvokeAsync<RepertoireGet, IActionResult>(f =>
            f.GetRepertoire(TestRequest.For(user.UserId)));

        var item = Assert.Single(Ok<PagedResult<RepertoireItemDto>>(listed).Items);
        Assert.Equal("Round Tripped", item.Title);
    }
}
