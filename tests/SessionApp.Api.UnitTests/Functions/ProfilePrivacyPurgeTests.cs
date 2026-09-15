using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using SessionApp.Api.TestSupport;
using AppDb = SessionApp.Api.Data.AppDbContext;
using Xunit;

namespace SessionApp.Api.UnitTests.Functions;

/// <summary>
/// Toggling profile privacy against the edge cache.
///
/// The public caching middleware stamps a 30-day s-maxage on every GET it serves, 404s included, so
/// a flip that does not purge is wrong at the edge for a month — in both directions. Going private
/// leaves cached 200s serving the very data being hidden; going public leaves cached 404s hiding a
/// profile that is live again. The profile purge alone is not enough: the set list and each
/// individual set are keyed on their own URLs.
/// </summary>
[Collection("CloudflareEnv")]
public class ProfilePrivacyPurgeTests
{
    private static User AddUser(AppDb db, Guid userId, string? username, bool isProfilePrivate = false)
    {
        var user = new User
        {
            UserId = userId,
            DisplayName = "Test",
            Username = username,
            Email = $"{userId}@example.com",
            IsProfilePrivate = isProfilePrivate,
        };
        db.Users.Add(user);
        return user;
    }

    private static async Task<(AppDb Db, Guid UserId, Guid SetId)> SeedUserWithASetAsync(bool isProfilePrivate)
    {
        var db = SetCacheTestDb.Create();
        var userId = Guid.NewGuid();
        AddUser(db, userId, "nora-reel", isProfilePrivate);
        var tune = new Tune { TuneId = Guid.NewGuid(), Title = "Cooley's", TuneType = TuneType.Reel, Key = "Edor" };
        db.Tunes.Add(tune);
        var userTune = new UserTune { UserTuneId = Guid.NewGuid(), UserId = userId, TuneId = tune.TuneId };
        db.UserTunes.Add(userTune);
        var set = new Set { SetId = Guid.NewGuid(), UserId = userId, Title = "Monday" };
        db.Sets.Add(set);
        db.SetItems.Add(new SetItem { SetId = set.SetId, UserTuneId = userTune.UserTuneId, SequenceNumber = 1 });
        await db.SaveChangesAsync();
        return (db, userId, set.SetId);
    }

    private static async Task<PurgeRecorder> FlipPrivacyAsync(AppDb db, Guid userId, bool toPrivate)
    {
        var recorder = PurgeRecorder.Create(out var purgeService);
        var handler = new SessionApp.Api.Functions.Users.Me.Patch(db, purgeService);
        var req = TestRequest.For(userId, body: new { IsProfilePrivate = toPrivate });

        var result = await handler.UpdateCurrentUser(req);

        Assert.IsType<OkObjectResult>(result);
        return recorder;
    }

    [Fact]
    public async Task GoingPrivate_PurgesTheProfileTheSetListAndEachSet()
    {
        var (db, userId, setId) = await SeedUserWithASetAsync(isProfilePrivate: false);
        using var _ = db;

        var recorder = await FlipPrivacyAsync(db, userId, toPrivate: true);

        Assert.Contains("/api/users/by-username/nora-reel/profile", recorder.PurgedPaths);
        Assert.Contains("/api/users/by-username/nora-reel/sets", recorder.PurgedPaths);
        Assert.Contains($"/api/users/{userId}/active-tunes", recorder.PurgedPaths);
        Assert.Contains($"/api/users/{userId}/gamification", recorder.PurgedPaths);
        Assert.Contains($"/api/sets/{setId}", recorder.PurgedPaths);
    }

    [Fact]
    public async Task GoingPublic_PurgesTheCached404sThatWouldKeepHidingTheProfile()
    {
        var (db, userId, setId) = await SeedUserWithASetAsync(isProfilePrivate: true);
        using var _ = db;

        var recorder = await FlipPrivacyAsync(db, userId, toPrivate: false);

        Assert.Contains("/api/users/by-username/nora-reel/profile", recorder.PurgedPaths);
        Assert.Contains("/api/users/by-username/nora-reel/sets", recorder.PurgedPaths);
        Assert.Contains($"/api/sets/{setId}", recorder.PurgedPaths);
    }

    [Fact]
    public async Task APatchThatLeavesPrivacyUnchanged_DoesNotPurgeTheSets()
    {
        // The per-set purge is proportional to how many sets the user owns, so it is worth keeping
        // off the path of an ordinary bio edit.
        var (db, userId, setId) = await SeedUserWithASetAsync(isProfilePrivate: false);
        using var _ = db;

        var recorder = PurgeRecorder.Create(out var purgeService);
        var handler = new SessionApp.Api.Functions.Users.Me.Patch(db, purgeService);
        var req = TestRequest.For(userId, body: new { Bio = "Fiddle player from Clare." });

        var result = await handler.UpdateCurrentUser(req);

        Assert.IsType<OkObjectResult>(result);
        Assert.Contains("/api/users/by-username/nora-reel/profile", recorder.PurgedPaths);
        Assert.DoesNotContain($"/api/sets/{setId}", recorder.PurgedPaths);
    }

    [Fact]
    public async Task ResendingTheSamePrivacyValue_IsNotTreatedAsAChange()
    {
        var (db, userId, setId) = await SeedUserWithASetAsync(isProfilePrivate: true);
        using var _ = db;

        var recorder = await FlipPrivacyAsync(db, userId, toPrivate: true);

        Assert.DoesNotContain($"/api/sets/{setId}", recorder.PurgedPaths);
    }
}
