using Microsoft.AspNetCore.Mvc;
using SessionApp.Api.Functions;
using SessionApp.Api.IntegrationTests.Infrastructure;
using SessionApp.Api.Models;
using SessionApp.Api.TestSupport;
using ActiveTunesGet = SessionApp.Api.Functions.Users.ByUserId.ActiveTunes.Get;
using GamificationGet = SessionApp.Api.Functions.Users.ByUserId.Gamification.Get;
using ProfileGet = SessionApp.Api.Functions.Users.ByUsername.Profile.Get;
using SetGet = SessionApp.Api.Functions.Sets.BySetId.Get;
using UserSetsGet = SessionApp.Api.Functions.Users.ByUsername.Sets.Get;

namespace SessionApp.Api.IntegrationTests.Users;

/// <summary>
/// The profile privacy flag, across every anonymous read that hangs off a profile.
///
/// Two of these reads are keyed on the username slug and two on the user id, so gating the slug
/// alone would leave a private user's tunes and badges fully served — each keyed read is covered
/// here separately for that reason. A private profile answers exactly as an unknown one does: 404,
/// never a 403, so going private does not confirm the slug is taken.
/// </summary>
public class ProfilePrivacyTests(CosmosEmulatorFixture fixture) : CosmosTestBase(fixture)
{
    [Fact]
    public async Task Profile_OfAPrivateUserIsNotFound()
    {
        await SeedAsync(db => db.SeedUserAsync(username: "hidden-profile", isProfilePrivate: true));

        var result = await InvokeAsync<ProfileGet, IActionResult>(fn =>
            fn.GetPublicUserProfileByUsername(TestRequest.Anonymous(), "hidden-profile"));

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Profile_OfAPublicUserIsStillServed()
    {
        var user = await SeedAsync(db => db.SeedUserAsync(username: "shown-profile"));

        var result = await InvokeAsync<ProfileGet, IActionResult>(fn =>
            fn.GetPublicUserProfileByUsername(TestRequest.Anonymous(), "shown-profile"));

        Assert.Equal(user.UserId, Ok<PublicUserProfileDto>(result).UserId);
    }

    /// <summary>
    /// The reason the flag is stored negatively. Cosmos documents written before the property
    /// existed simply lack it, and EF materializes a missing property as the CLR default — so with
    /// an <c>IsProfilePublic</c> flag every existing user would have read back as private and gone
    /// dark on deploy. Absent must mean public.
    /// </summary>
    [Fact]
    public async Task Profile_OfAUserStoredBeforeTheFlagExistedIsPublic()
    {
        var user = await SeedAsync(db => db.SeedUserAsync(username: "legacy-profile"));
        await Fixture.StripPropertiesAsync(nameof(User), user.UserId, nameof(User.IsProfilePrivate));

        var result = await InvokeAsync<ProfileGet, IActionResult>(fn =>
            fn.GetPublicUserProfileByUsername(TestRequest.Anonymous(), "legacy-profile"));

        Assert.Equal(user.UserId, Ok<PublicUserProfileDto>(result).UserId);
    }

    [Fact]
    public async Task Sets_OfAPrivateUserAreNotFound()
    {
        var user = await SeedAsync(db => db.SeedUserAsync(username: "hidden-sets", isProfilePrivate: true));
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        var userTune = await SeedAsync(db => db.SeedUserTuneAsync(user, tune));
        await SeedAsync(db => db.SeedSetAsync(user, "Monday", userTune));

        var result = await InvokeAsync<UserSetsGet, IActionResult>(fn =>
            fn.GetPublicUserSetsByUsername(TestRequest.Anonymous(), "hidden-sets"));

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task ActiveTunes_OfAPrivateUserAreNotFound()
    {
        // Keyed on the user id, not the slug — the slug gate does not cover this read at all.
        var user = await SeedAsync(db => db.SeedUserAsync(username: "hidden-tunes", isProfilePrivate: true));
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune, TuneStatus.Active));

        var result = await InvokeAsync<ActiveTunesGet, IActionResult>(fn =>
            fn.GetPublicActiveTunes(TestRequest.Anonymous(), user.UserId));

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task ActiveTunes_OfAPublicUserAreStillServed()
    {
        var user = await SeedAsync(db => db.SeedUserAsync(username: "shown-tunes"));
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune, TuneStatus.Active));

        var result = await InvokeAsync<ActiveTunesGet, IActionResult>(fn =>
            fn.GetPublicActiveTunes(TestRequest.Anonymous(), user.UserId));

        Assert.Single(Ok<List<PublicActiveTuneDto>>(result));
    }

    [Fact]
    public async Task Gamification_OfAPrivateUserIsNotFound()
    {
        var user = await SeedAsync(db => db.SeedUserAsync(username: "hidden-badges", isProfilePrivate: true));

        var result = await InvokeAsync<GamificationGet, IActionResult>(fn =>
            fn.GetPublicGamificationSummary(TestRequest.Anonymous(), user.UserId));

        Assert.IsType<NotFoundResult>(result);
    }

    /// <summary>
    /// A set outlives the profile page that links to it, so the set's own URL has to honour the
    /// owner's flag too — otherwise every previously-shared set link keeps working after the user
    /// goes private, which is the one link they most expect to break.
    /// </summary>
    [Fact]
    public async Task Set_OwnedByAPrivateUserIsNotFoundByItsOwnId()
    {
        var user = await SeedAsync(db => db.SeedUserAsync(username: "hidden-set-owner", isProfilePrivate: true));
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        var userTune = await SeedAsync(db => db.SeedUserTuneAsync(user, tune));
        var set = await SeedAsync(db => db.SeedSetAsync(user, "Monday", userTune));

        var result = await InvokeAsync<SetGet, IActionResult>(fn =>
            fn.GetSet(TestRequest.Anonymous(), set.SetId));

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Set_OwnedByAPublicUserIsStillServed()
    {
        var user = await SeedAsync(db => db.SeedUserAsync(username: "shown-set-owner"));
        var tune = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        var userTune = await SeedAsync(db => db.SeedUserTuneAsync(user, tune));
        var set = await SeedAsync(db => db.SeedSetAsync(user, "Monday", userTune));

        var result = await InvokeAsync<SetGet, IActionResult>(fn =>
            fn.GetSet(TestRequest.Anonymous(), set.SetId));

        Assert.IsType<OkObjectResult>(result);
    }
}
