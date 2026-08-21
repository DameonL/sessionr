using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Functions;
using SessionApp.Api.IntegrationTests.Infrastructure;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using SessionApp.Api.TestSupport;
using SetsGet = SessionApp.Api.Functions.Sets.Get;
using SetsPost = SessionApp.Api.Functions.Sets.Post;
using SetDelete = SessionApp.Api.Functions.Sets.BySetId.Delete;
using SetPut = SessionApp.Api.Functions.Sets.BySetId.Put;

namespace SessionApp.Api.IntegrationTests.Sets;

/// <summary>
/// Sets exercise the deepest stitch chain in the app — Set → SetItem → UserTune → Tune/TuneSetting,
/// four separate Cosmos documents with no navigation between any of them. Everything here would
/// have been a single <c>.Include(...)</c> chain on a relational store.
/// </summary>
public class SetRoundTripTests(CosmosEmulatorFixture fixture) : CosmosTestBase(fixture)
{
    private sealed record Fixtures(Models.User User, UserTune First, UserTune Second, UserTune Third);

    private async Task<Fixtures> SeedThreeTunesAsync()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var cooleys = await SeedAsync(db => db.SeedTuneAsync("Cooley's", TuneType.Reel, "Edor", TestData.CooleysAbc));
        var maggie = await SeedAsync(db => db.SeedTuneAsync("Drowsy Maggie", TuneType.Reel, "Edor", TestData.DrowsyMaggieAbc));
        var bank = await SeedAsync(db => db.SeedTuneAsync("The Bank of Ireland", TuneType.Reel, "G", TestData.BankOfIrelandAbc));

        return new Fixtures(
            user,
            await SeedAsync(db => db.SeedUserTuneAsync(user, cooleys)),
            await SeedAsync(db => db.SeedUserTuneAsync(user, maggie)),
            await SeedAsync(db => db.SeedUserTuneAsync(user, bank)));
    }

    private static SaveSetRequest Request(string title, params UserTune[] tunes) =>
        new(title, [.. tunes.Select(t => new SaveSetItem(t.UserTuneId, 2))]);

    [Fact]
    public async Task Post_RejectsAnUnauthenticatedCaller()
    {
        var result = await InvokeAsync<SetsPost, IActionResult>(f =>
            f.CreateSet(TestRequest.Anonymous(new SaveSetRequest("Anything", []))));

        AssertStatus(401, result);
    }

    [Fact]
    public async Task Post_CreatesASetAndReturnsItFullyStitched()
    {
        var f = await SeedThreeTunesAsync();

        var result = await InvokeAsync<SetsPost, IActionResult>(fn => fn.CreateSet(
            TestRequest.For(f.User.UserId, body: Request("The Kesh Set", f.First, f.Second))));

        var ok = Assert.IsType<OkObjectResult>(result);
        var items = ItemsOf(ok.Value!);

        Assert.Equal(["Cooley's", "Drowsy Maggie"], items.Select(i => i.Title));
        Assert.Equal([1, 2], items.Select(i => i.SequenceNumber));
        // The ABC comes from the Tune document, three stitches away from the Set.
        Assert.Equal(TestData.CooleysAbc, items[0].Abc);
    }

    [Fact]
    public async Task Post_PersistsItemsAsSeparateDocumentsKeyedBySetId()
    {
        var f = await SeedThreeTunesAsync();

        var result = await InvokeAsync<SetsPost, IActionResult>(fn => fn.CreateSet(
            TestRequest.For(f.User.UserId, body: Request("Persisted", f.First, f.Second))));
        var setId = SetIdOf(Assert.IsType<OkObjectResult>(result).Value!);

        var stored = await Fixture.WithDbAsync(db =>
            db.SetItems.AsNoTracking().Where(si => si.SetId == setId).ToListAsync());

        Assert.Equal(2, stored.Count);
        Assert.Equal([1, 2], stored.OrderBy(si => si.SequenceNumber).Select(si => si.SequenceNumber));
    }

    [Fact]
    public async Task Post_KeepsTheOrderTheCallerAskedFor()
    {
        var f = await SeedThreeTunesAsync();

        // Deliberately not alphabetical, and not the order the tunes were seeded in.
        var result = await InvokeAsync<SetsPost, IActionResult>(fn => fn.CreateSet(
            TestRequest.For(f.User.UserId, body: Request("Ordered", f.Third, f.First, f.Second))));

        Assert.Equal(
            ["The Bank of Ireland", "Cooley's", "Drowsy Maggie"],
            ItemsOf(Assert.IsType<OkObjectResult>(result).Value!).Select(i => i.Title));
    }

    [Fact]
    public async Task Post_ClampsRepetitionsToASensibleRange()
    {
        var f = await SeedThreeTunesAsync();
        var body = new SaveSetRequest("Clamped",
        [
            new SaveSetItem(f.First.UserTuneId, 0),   // below the floor
            new SaveSetItem(f.Second.UserTuneId, 99), // above the ceiling
        ]);

        var result = await InvokeAsync<SetsPost, IActionResult>(fn =>
            fn.CreateSet(TestRequest.For(f.User.UserId, body: body)));

        Assert.Equal([1, 9], ItemsOf(Assert.IsType<OkObjectResult>(result).Value!).Select(i => i.Repetitions));
    }

    [Fact]
    public async Task Post_IncludesThePlaytimeAndKeyTransitionAnalysis()
    {
        var f = await SeedThreeTunesAsync();

        var result = await InvokeAsync<SetsPost, IActionResult>(fn => fn.CreateSet(
            TestRequest.For(f.User.UserId, body: Request("Analysed", f.First, f.Third))));

        var analysis = AnalysisOf(Assert.IsType<OkObjectResult>(result).Value!);
        Assert.Equal(140, analysis.TotalSeconds); // two reels x 2 repetitions x 35s
        var transition = Assert.Single(analysis.Transitions);
        Assert.Equal("Cooley's", transition.FromTitle);
        Assert.Equal("The Bank of Ireland", transition.ToTitle);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Post_RequiresATitle(string title)
    {
        var f = await SeedThreeTunesAsync();

        var result = await InvokeAsync<SetsPost, IActionResult>(fn =>
            fn.CreateSet(TestRequest.For(f.User.UserId, body: Request(title, f.First))));

        AssertStatus(400, result);
    }

    [Fact]
    public async Task Post_RequiresAtLeastOneTune()
    {
        var f = await SeedThreeTunesAsync();

        var result = await InvokeAsync<SetsPost, IActionResult>(fn =>
            fn.CreateSet(TestRequest.For(f.User.UserId, body: new SaveSetRequest("Empty", []))));

        AssertStatus(400, result);
    }

    [Fact]
    public async Task Post_RefusesTheSameTuneTwiceInOneSet()
    {
        var f = await SeedThreeTunesAsync();

        var result = await InvokeAsync<SetsPost, IActionResult>(fn =>
            fn.CreateSet(TestRequest.For(f.User.UserId, body: Request("Doubled", f.First, f.First))));

        AssertStatus(400, result);
    }

    [Fact]
    public async Task Post_RefusesTunesFromSomeoneElsesRepertoire()
    {
        // The ownership check counts via CosmosCountAsync — there is no FK on Cosmos to catch this.
        var f = await SeedThreeTunesAsync();
        var stranger = await SeedAsync(db => db.SeedUserAsync());
        var theirTune = await SeedAsync(db => db.SeedTuneAsync("Not Yours"));
        var theirUserTune = await SeedAsync(db => db.SeedUserTuneAsync(stranger, theirTune));

        var result = await InvokeAsync<SetsPost, IActionResult>(fn =>
            fn.CreateSet(TestRequest.For(f.User.UserId, body: Request("Borrowed", f.First, theirUserTune))));

        AssertStatus(400, result);
    }

    [Fact]
    public async Task Post_RefusesAUserTuneThatDoesNotExist()
    {
        var f = await SeedThreeTunesAsync();
        var body = new SaveSetRequest("Ghost", [new SaveSetItem(TestData.NewId(), 2)]);

        var result = await InvokeAsync<SetsPost, IActionResult>(fn =>
            fn.CreateSet(TestRequest.For(f.User.UserId, body: body)));

        AssertStatus(400, result);
    }

    // --- GET ---

    [Fact]
    public async Task Get_ListsTheCallersSetsWithTheirStitchedItems()
    {
        var f = await SeedThreeTunesAsync();
        await SeedAsync(db => db.SeedSetAsync(f.User, "Second Set", f.Third));
        await SeedAsync(db => db.SeedSetAsync(f.User, "First Set", f.First, f.Second));

        var result = await InvokeAsync<SetsGet, IActionResult>(fn =>
            fn.GetSets(TestRequest.For(f.User.UserId)));

        var sets = Ok<List<SetSummaryDto>>(result);
        Assert.Equal(["First Set", "Second Set"], sets.Select(s => s.Title)); // ordered by title
        Assert.Equal(["Cooley's", "Drowsy Maggie"], sets[0].Items.Select(i => i.Title));
        Assert.Equal(["The Bank of Ireland"], sets[1].Items.Select(i => i.Title));
    }

    [Fact]
    public async Task Get_DoesNotLeakAnotherUsersSets()
    {
        var f = await SeedThreeTunesAsync();
        await SeedAsync(db => db.SeedSetAsync(f.User, "Mine", f.First));

        var stranger = await SeedAsync(db => db.SeedUserAsync());
        var theirTune = await SeedAsync(db => db.SeedTuneAsync("Theirs"));
        var theirUserTune = await SeedAsync(db => db.SeedUserTuneAsync(stranger, theirTune));
        await SeedAsync(db => db.SeedSetAsync(stranger, "Theirs", theirUserTune));

        var result = await InvokeAsync<SetsGet, IActionResult>(fn =>
            fn.GetSets(TestRequest.For(f.User.UserId)));

        var set = Assert.Single(Ok<List<SetSummaryDto>>(result));
        Assert.Equal("Mine", set.Title);
    }

    [Fact]
    public async Task Get_ReportsThePinnedSettingsKeyForAnItem()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's", key: "Edor"));
        var setting = await SeedAsync(db => db.SeedTuneSettingAsync(tune, key: "Ador"));
        var userTune = await SeedAsync(db => db.SeedUserTuneAsync(user, tune, tuneSettingId: setting.TuneSettingId));
        await SeedAsync(db => db.SeedSetAsync(user, "Pinned", userTune));

        var result = await InvokeAsync<SetsGet, IActionResult>(fn => fn.GetSets(TestRequest.For(user.UserId)));

        var item = Assert.Single(Assert.Single(Ok<List<SetSummaryDto>>(result)).Items);
        Assert.Equal("Ador", item.Key);
    }

    [Fact]
    public async Task Get_ANewUserHasNoSets()
    {
        var result = await InvokeAsync<SetsGet, IActionResult>(fn =>
            fn.GetSets(TestRequest.For(TestData.NewId(), TestData.NewEmail())));

        Assert.Empty(Ok<List<SetSummaryDto>>(result));
    }

    // --- PUT / DELETE ---

    [Fact]
    public async Task Put_ReplacesTheTitleAndTheTuneOrder()
    {
        var f = await SeedThreeTunesAsync();
        var set = await SeedAsync(db => db.SeedSetAsync(f.User, "Original", f.First, f.Second));

        var result = await InvokeAsync<SetPut, IActionResult>(fn => fn.UpdateSet(
            TestRequest.For(f.User.UserId, body: Request("Renamed", f.Third, f.First)), set.SetId));

        var items = ItemsOf(Assert.IsType<OkObjectResult>(result).Value!);
        Assert.Equal(["The Bank of Ireland", "Cooley's"], items.Select(i => i.Title));

        var reloaded = await Fixture.WithDbAsync(db => db.Sets.AsNoTracking().SingleAsync(s => s.SetId == set.SetId));
        Assert.Equal("Renamed", reloaded.Title);
    }

    [Fact]
    public async Task Put_LeavesNoOrphanedItemDocumentsBehind()
    {
        // Items are separate documents with no cascade on Cosmos — the endpoint has to delete
        // the old ones itself, and a leak here would silently corrupt the set on the next read.
        var f = await SeedThreeTunesAsync();
        var set = await SeedAsync(db => db.SeedSetAsync(f.User, "Original", f.First, f.Second, f.Third));

        await InvokeAsync<SetPut, IActionResult>(fn => fn.UpdateSet(
            TestRequest.For(f.User.UserId, body: Request("Shorter", f.Second)), set.SetId));

        var stored = await Fixture.WithDbAsync(db =>
            db.SetItems.AsNoTracking().Where(si => si.SetId == set.SetId).ToListAsync());

        Assert.Single(stored);
        Assert.Equal(f.Second.UserTuneId, stored[0].UserTuneId);
    }

    [Fact]
    public async Task Put_RefusesToEditSomeoneElsesSet()
    {
        var f = await SeedThreeTunesAsync();
        var set = await SeedAsync(db => db.SeedSetAsync(f.User, "Mine", f.First));
        var stranger = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<SetPut, IActionResult>(fn => fn.UpdateSet(
            TestRequest.For(stranger.UserId, body: Request("Hijacked", f.First)), set.SetId));

        Assert.IsType<NotFoundResult>(result); // not found rather than forbidden: don't confirm it exists
    }

    [Fact]
    public async Task Put_OnAnUnknownSetIsNotFound()
    {
        var f = await SeedThreeTunesAsync();

        var result = await InvokeAsync<SetPut, IActionResult>(fn => fn.UpdateSet(
            TestRequest.For(f.User.UserId, body: Request("Ghost", f.First)), TestData.NewId()));

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Delete_RemovesTheSet()
    {
        var f = await SeedThreeTunesAsync();
        var set = await SeedAsync(db => db.SeedSetAsync(f.User, "Doomed", f.First));

        var result = await InvokeAsync<SetDelete, IActionResult>(fn =>
            fn.DeleteSet(TestRequest.For(f.User.UserId), set.SetId));

        Assert.IsType<NoContentResult>(result);
        Assert.Empty(await Fixture.WithDbAsync(db =>
            db.Sets.AsNoTracking().Where(s => s.SetId == set.SetId).ToListAsync()));
    }

    [Fact]
    public async Task Delete_RefusesToRemoveSomeoneElsesSet()
    {
        var f = await SeedThreeTunesAsync();
        var set = await SeedAsync(db => db.SeedSetAsync(f.User, "Mine", f.First));
        var stranger = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<SetDelete, IActionResult>(fn =>
            fn.DeleteSet(TestRequest.For(stranger.UserId), set.SetId));

        Assert.IsType<NotFoundResult>(result);
        Assert.Single(await Fixture.WithDbAsync(db =>
            db.Sets.AsNoTracking().Where(s => s.SetId == set.SetId).ToListAsync()));
    }

    [Fact]
    public async Task PostThenGet_TheCreatedSetIsListedWithItsTunes()
    {
        var f = await SeedThreeTunesAsync();

        await InvokeAsync<SetsPost, IActionResult>(fn => fn.CreateSet(
            TestRequest.For(f.User.UserId, body: Request("Round Trip", f.First, f.Second, f.Third))));

        var listed = await InvokeAsync<SetsGet, IActionResult>(fn => fn.GetSets(TestRequest.For(f.User.UserId)));

        var set = Assert.Single(Ok<List<SetSummaryDto>>(listed));
        Assert.Equal("Round Trip", set.Title);
        Assert.Equal(["Cooley's", "Drowsy Maggie", "The Bank of Ireland"], set.Items.Select(i => i.Title));
    }

    // The create/update endpoints return an anonymous type, so reach into it reflectively rather
    // than reshaping production code for the tests' convenience.
    private static Guid SetIdOf(object payload) => (Guid)payload.GetType().GetProperty("SetId")!.GetValue(payload)!;

    private static List<SetItemDto> ItemsOf(object payload) =>
        (List<SetItemDto>)payload.GetType().GetProperty("Items")!.GetValue(payload)!;

    private static SetAnalysis AnalysisOf(object payload) =>
        (SetAnalysis)payload.GetType().GetProperty("Analysis")!.GetValue(payload)!;
}
