using Microsoft.AspNetCore.Mvc;
using SessionApp.Api.Functions;
using SessionApp.Api.IntegrationTests.Infrastructure;
using SessionApp.Api.Models;
using SessionApp.Api.TestSupport;
using ProfileGet = SessionApp.Api.Functions.Users.ByUsername.Profile.Get;

namespace SessionApp.Api.IntegrationTests.Users;

/// <summary>
/// The public profile document. It carries the active-tune and set counts so the profile page can
/// label its tabs without fetching either list — prefetching both cost up to ~15 KB gzipped on a
/// landing view that needed two integers.
/// </summary>
public class PublicProfileTests(CosmosEmulatorFixture fixture) : CosmosTestBase(fixture)
{
    [Fact]
    public async Task Get_ReportsTheActiveTuneAndSetCounts()
    {
        var user = await SeedAsync(db => db.SeedUserAsync(username: "counted"));
        var first = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        var second = await SeedAsync(db => db.SeedTuneAsync("The Butterfly", TuneType.SlipJig));
        var firstUserTune = await SeedAsync(db => db.SeedUserTuneAsync(user, first));
        await SeedAsync(db => db.SeedUserTuneAsync(user, second));
        await SeedAsync(db => db.SeedSetAsync(user, "Monday", firstUserTune));

        var result = await InvokeAsync<ProfileGet, IActionResult>(fn =>
            fn.GetPublicUserProfileByUsername(TestRequest.Anonymous(), "counted"));

        var profile = Ok<PublicUserProfileDto>(result);
        Assert.Equal(2, profile.ActiveTuneCount);
        Assert.Equal(1, profile.SetCount);
    }

    [Fact]
    public async Task Get_CountsOnlyTunesAtActiveStatus()
    {
        var user = await SeedAsync(db => db.SeedUserAsync(username: "only-active"));
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        var wishlisted = await SeedAsync(db => db.SeedTuneAsync("The Butterfly", TuneType.SlipJig));
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune, TuneStatus.Active));
        await SeedAsync(db => db.SeedUserTuneAsync(user, wishlisted, TuneStatus.Wishlist));

        var result = await InvokeAsync<ProfileGet, IActionResult>(fn =>
            fn.GetPublicUserProfileByUsername(TestRequest.Anonymous(), "only-active"));

        Assert.Equal(1, Ok<PublicUserProfileDto>(result).ActiveTuneCount);
    }

    [Fact]
    public async Task Get_ReportsZeroRatherThanOmittingTheCounts()
    {
        // The tab badges render the number as-is; an absent count would read as a missing tab.
        await SeedAsync(db => db.SeedUserAsync(username: "brand-new"));

        var result = await InvokeAsync<ProfileGet, IActionResult>(fn =>
            fn.GetPublicUserProfileByUsername(TestRequest.Anonymous(), "brand-new"));

        var profile = Ok<PublicUserProfileDto>(result);
        Assert.Equal(0, profile.ActiveTuneCount);
        Assert.Equal(0, profile.SetCount);
    }

    [Fact]
    public async Task Get_DoesNotCountAnotherUsersTunesOrSets()
    {
        var user = await SeedAsync(db => db.SeedUserAsync(username: "mine-counted"));
        var stranger = await SeedAsync(db => db.SeedUserAsync(username: "theirs-counted"));
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        var theirUserTune = await SeedAsync(db => db.SeedUserTuneAsync(stranger, tune));
        await SeedAsync(db => db.SeedSetAsync(stranger, "Theirs", theirUserTune));

        var result = await InvokeAsync<ProfileGet, IActionResult>(fn =>
            fn.GetPublicUserProfileByUsername(TestRequest.Anonymous(), "mine-counted"));

        var profile = Ok<PublicUserProfileDto>(result);
        Assert.Equal(user.UserId, profile.UserId);
        Assert.Equal(0, profile.ActiveTuneCount);
        Assert.Equal(0, profile.SetCount);
    }

    [Fact]
    public async Task Get_OnAnUnknownUsernameIsNotFound()
    {
        var result = await InvokeAsync<ProfileGet, IActionResult>(fn =>
            fn.GetPublicUserProfileByUsername(TestRequest.Anonymous(), "nobody-here"));

        Assert.IsType<NotFoundResult>(result);
    }
}
