using Microsoft.AspNetCore.Mvc;
using SessionApp.Api.Functions;
using SessionApp.Api.IntegrationTests.Infrastructure;
using SessionApp.Api.Models;
using SessionApp.Api.TestSupport;
using PublicSetGet = SessionApp.Api.Functions.Sets.BySetId.Get;
using PublicUserSetsGet = SessionApp.Api.Functions.Users.ByUsername.Sets.Get;

namespace SessionApp.Api.IntegrationTests.Sets;

/// <summary>
/// The anonymous read paths behind a shared set link and the sets section of a public profile.
/// Sets follow profile privacy: the username slug is the whole gate, so a user with no slug has no
/// public list, and the per-set read stays keyed on an unguessable id.
/// </summary>
public class PublicSetTests(CosmosEmulatorFixture fixture) : CosmosTestBase(fixture)
{
    private sealed record Fixtures(Models.User User, UserTune First, UserTune Second);

    private async Task<Fixtures> SeedUserWithTunesAsync(string? username)
    {
        var user = await SeedAsync(db => db.SeedUserAsync(username: username));
        var cooleys = await SeedAsync(db => db.SeedTuneAsync("Cooley's", TuneType.Reel, "Edor", TestData.CooleysAbc));
        var maggie = await SeedAsync(db => db.SeedTuneAsync("Drowsy Maggie", TuneType.Reel, "Edor", TestData.DrowsyMaggieAbc));

        return new Fixtures(
            user,
            await SeedAsync(db => db.SeedUserTuneAsync(user, cooleys)),
            await SeedAsync(db => db.SeedUserTuneAsync(user, maggie)));
    }

    // --- GET /api/sets/{setId} ---

    [Fact]
    public async Task GetSet_ServesASetToAnAnonymousCaller()
    {
        var f = await SeedUserWithTunesAsync("the-piper");
        var set = await SeedAsync(db => db.SeedSetAsync(f.User, "Shared Link", f.First, f.Second));

        var result = await InvokeAsync<PublicSetGet, IActionResult>(fn =>
            fn.GetSet(TestRequest.Anonymous(), set.SetId));

        var ok = Assert.IsType<OkObjectResult>(result);
        var items = ItemsOf(ok.Value!);
        Assert.Equal(["Cooley's", "Drowsy Maggie"], items.Select(i => i.Title));
        // The whole point of the public read: a visitor can play it, so the ABC has to be there.
        Assert.Equal(TestData.CooleysAbc, items[0].Abc);
    }

    [Fact]
    public async Task GetSet_CarriesTheLibraryTuneIdSoAVisitorsTuneLinksResolve()
    {
        // UserTuneId names a private repertoire entry; only TuneId points somewhere anonymous.
        var f = await SeedUserWithTunesAsync("the-piper");
        var set = await SeedAsync(db => db.SeedSetAsync(f.User, "Linked", f.First));

        var result = await InvokeAsync<PublicSetGet, IActionResult>(fn =>
            fn.GetSet(TestRequest.Anonymous(), set.SetId));

        var item = Assert.Single(ItemsOf(Assert.IsType<OkObjectResult>(result).Value!));
        Assert.Equal(f.First.TuneId, item.TuneId);
    }

    [Fact]
    public async Task GetSet_OnAnUnknownSetIsNotFound()
    {
        var result = await InvokeAsync<PublicSetGet, IActionResult>(fn =>
            fn.GetSet(TestRequest.Anonymous(), TestData.NewId()));

        Assert.IsType<NotFoundResult>(result);
    }

    // --- GET /api/users/by-username/{username}/sets ---

    [Fact]
    public async Task GetUserSets_ListsThatUsersSetsToAnAnonymousCaller()
    {
        var f = await SeedUserWithTunesAsync("nora-reel");
        await SeedAsync(db => db.SeedSetAsync(f.User, "Second Set", f.Second));
        await SeedAsync(db => db.SeedSetAsync(f.User, "First Set", f.First));

        var result = await InvokeAsync<PublicUserSetsGet, IActionResult>(fn =>
            fn.GetPublicUserSetsByUsername(TestRequest.Anonymous(), "nora-reel"));

        var sets = Ok<List<SetSummaryDto>>(result);
        Assert.Equal(["First Set", "Second Set"], sets.Select(s => s.Title)); // ordered by title
        Assert.Equal(["Cooley's"], sets[0].Items.Select(i => i.Title));
        Assert.Equal(["Drowsy Maggie"], sets[1].Items.Select(i => i.Title));
    }

    [Fact]
    public async Task GetUserSets_MatchesTheSlugCaseInsensitively()
    {
        var f = await SeedUserWithTunesAsync("case-test");
        await SeedAsync(db => db.SeedSetAsync(f.User, "Mine", f.First));

        var result = await InvokeAsync<PublicUserSetsGet, IActionResult>(fn =>
            fn.GetPublicUserSetsByUsername(TestRequest.Anonymous(), " Case-Test "));

        Assert.Single(Ok<List<SetSummaryDto>>(result));
    }

    [Fact]
    public async Task GetUserSets_DoesNotIncludeAnotherUsersSets()
    {
        var f = await SeedUserWithTunesAsync("mine-only");
        await SeedAsync(db => db.SeedSetAsync(f.User, "Mine", f.First));

        var stranger = await SeedUserWithTunesAsync("someone-else");
        await SeedAsync(db => db.SeedSetAsync(stranger.User, "Theirs", stranger.First));

        var result = await InvokeAsync<PublicUserSetsGet, IActionResult>(fn =>
            fn.GetPublicUserSetsByUsername(TestRequest.Anonymous(), "mine-only"));

        var set = Assert.Single(Ok<List<SetSummaryDto>>(result));
        Assert.Equal("Mine", set.Title);
    }

    [Fact]
    public async Task GetUserSets_OnAnUnknownUsernameIsNotFound()
    {
        var result = await InvokeAsync<PublicUserSetsGet, IActionResult>(fn =>
            fn.GetPublicUserSetsByUsername(TestRequest.Anonymous(), "nobody-here"));

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task GetUserSets_AUserWithoutAPublicProfileHasNoPublicList()
    {
        // No username slug means no public profile, and sets follow profile privacy.
        var f = await SeedUserWithTunesAsync(username: null);
        await SeedAsync(db => db.SeedSetAsync(f.User, "Unlisted", f.First));

        var result = await InvokeAsync<PublicUserSetsGet, IActionResult>(fn =>
            fn.GetPublicUserSetsByUsername(TestRequest.Anonymous(), ""));

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task GetUserSets_AUserWithNoSetsListsNothing()
    {
        await SeedUserWithTunesAsync("empty-handed");

        var result = await InvokeAsync<PublicUserSetsGet, IActionResult>(fn =>
            fn.GetPublicUserSetsByUsername(TestRequest.Anonymous(), "empty-handed"));

        Assert.Empty(Ok<List<SetSummaryDto>>(result));
    }

    // The single-set endpoint returns an anonymous type; reach into it reflectively rather than
    // reshaping production code for the tests' convenience.
    private static List<SetItemDto> ItemsOf(object payload) =>
        (List<SetItemDto>)payload.GetType().GetProperty("Items")!.GetValue(payload)!;
}
