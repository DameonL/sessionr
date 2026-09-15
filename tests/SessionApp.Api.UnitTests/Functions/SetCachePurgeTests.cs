using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Functions;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using SessionApp.Api.TestSupport;
using AppDb = SessionApp.Api.Data.AppDbContext;
using Xunit;

namespace SessionApp.Api.UnitTests.Functions;

/// <summary>
/// A set is read through the public API, whose responses Cloudflare holds for a month, so every
/// write that changes what a set looks like has to purge it. None of them did.
/// </summary>
[Collection("CloudflareEnv")]
public class SetCachePurgeTests
{
    private static readonly SetAnalyzer Analyzer = new();

    private static User AddUser(AppDb db, Guid userId, string? username = null)
    {
        var user = new User { UserId = userId, DisplayName = "Test", Username = username, Email = $"{userId}@example.com" };
        db.Users.Add(user);
        return user;
    }

    private static Tune AddTune(AppDb db, string title = "The Kesh")
    {
        var tune = new Tune
        {
            TuneId = Guid.NewGuid(),
            Title = title,
            TuneType = TuneType.Jig,
            Key = "Gmaj",
            MasterAbcText = "X:1\nK:G\nGAB|",
        };
        db.Tunes.Add(tune);
        return tune;
    }

    private static UserTune AddUserTune(AppDb db, Guid userId, Tune tune)
    {
        var userTune = new UserTune { UserTuneId = Guid.NewGuid(), UserId = userId, TuneId = tune.TuneId };
        db.UserTunes.Add(userTune);
        return userTune;
    }

    [Fact]
    public async Task UpdateSet_PurgesTheSetsPublicUrl()
    {
        using var db = SetCacheTestDb.Create();
        var userId = Guid.NewGuid();
        AddUser(db, userId);
        var tune = AddTune(db);
        var userTune = AddUserTune(db, userId, tune);
        var set = new Set { SetId = Guid.NewGuid(), UserId = userId, Title = "Monday" };
        db.Sets.Add(set);
        db.SetItems.Add(new SetItem { SetId = set.SetId, UserTuneId = userTune.UserTuneId, SequenceNumber = 1 });
        await db.SaveChangesAsync();

        var recorder = PurgeRecorder.Create(out var purgeService);
        var handler = new SessionApp.Api.Functions.Sets.BySetId.Put(db, Analyzer, purgeService);
        var req = TestRequest.For(userId, body: new
        {
            Title = "Tuesday",
            Items = new[] { new { UserTuneId = userTune.UserTuneId, Repetitions = 3 } },
        });

        var result = await handler.UpdateSet(req, set.SetId);

        Assert.IsType<OkObjectResult>(result);
        Assert.Contains($"/api/sets/{set.SetId}", recorder.PurgedPaths);
    }

    [Fact]
    public async Task DeleteSet_PurgesTheUrlAndTakesItsItemsWithIt()
    {
        using var db = SetCacheTestDb.Create();
        var userId = Guid.NewGuid();
        AddUser(db, userId);
        var tune = AddTune(db);
        var userTune = AddUserTune(db, userId, tune);
        var set = new Set { SetId = Guid.NewGuid(), UserId = userId, Title = "Monday" };
        db.Sets.Add(set);
        db.SetItems.Add(new SetItem { SetId = set.SetId, UserTuneId = userTune.UserTuneId, SequenceNumber = 1 });
        await db.SaveChangesAsync();

        var recorder = PurgeRecorder.Create(out var purgeService);
        var handler = new SessionApp.Api.Functions.Sets.BySetId.Delete(db, purgeService);

        var result = await handler.DeleteSet(TestRequest.For(userId), set.SetId);

        Assert.IsType<NoContentResult>(result);
        Assert.Contains($"/api/sets/{set.SetId}", recorder.PurgedPaths);
        // Cosmos has no cascade, so the items were being orphaned rather than deleted.
        Assert.Empty(await db.SetItems.Where(si => si.SetId == set.SetId).ToListAsync());
    }

    [Fact]
    public async Task UpdateSet_PurgesTheOwnersPublicProfileSetList()
    {
        // The profile list repeats the set's title and tune titles, and is cached just as long.
        using var db = SetCacheTestDb.Create();
        var userId = Guid.NewGuid();
        AddUser(db, userId, "nora-reel");
        var tune = AddTune(db);
        var userTune = AddUserTune(db, userId, tune);
        var set = new Set { SetId = Guid.NewGuid(), UserId = userId, Title = "Monday" };
        db.Sets.Add(set);
        db.SetItems.Add(new SetItem { SetId = set.SetId, UserTuneId = userTune.UserTuneId, SequenceNumber = 1 });
        await db.SaveChangesAsync();

        var recorder = PurgeRecorder.Create(out var purgeService);
        var handler = new SessionApp.Api.Functions.Sets.BySetId.Put(db, Analyzer, purgeService);
        var req = TestRequest.For(userId, body: new
        {
            Title = "Tuesday",
            Items = new[] { new { UserTuneId = userTune.UserTuneId, Repetitions = 3 } },
        });

        var result = await handler.UpdateSet(req, set.SetId);

        Assert.IsType<OkObjectResult>(result);
        Assert.Contains("/api/users/by-username/nora-reel/sets", recorder.PurgedPaths);
    }

    [Fact]
    public async Task DeleteSet_PurgesNoProfileListForAUserWithoutAUsername()
    {
        // No slug means no public profile and so no list URL — purging one would be a nonsense URL.
        using var db = SetCacheTestDb.Create();
        var userId = Guid.NewGuid();
        AddUser(db, userId, username: null);
        var tune = AddTune(db);
        var userTune = AddUserTune(db, userId, tune);
        var set = new Set { SetId = Guid.NewGuid(), UserId = userId, Title = "Monday" };
        db.Sets.Add(set);
        db.SetItems.Add(new SetItem { SetId = set.SetId, UserTuneId = userTune.UserTuneId, SequenceNumber = 1 });
        await db.SaveChangesAsync();

        var recorder = PurgeRecorder.Create(out var purgeService);
        var handler = new SessionApp.Api.Functions.Sets.BySetId.Delete(db, purgeService);

        var result = await handler.DeleteSet(TestRequest.For(userId), set.SetId);

        Assert.IsType<NoContentResult>(result);
        Assert.Contains($"/api/sets/{set.SetId}", recorder.PurgedPaths);
        Assert.DoesNotContain(recorder.PurgedPaths, p => p.Contains("/by-username/"));
    }

    [Fact]
    public async Task UpdateGroupSet_PurgesTheSetAndTheGroupsList()
    {
        using var db = SetCacheTestDb.Create();
        var (userId, groupId, groupTune, groupSet) = await SeedGroupSetAsync(db);

        var recorder = PurgeRecorder.Create(out var purgeService);
        var handler = new SessionApp.Api.Functions.GroupSets.ByGroupSetId.Put(db, Analyzer, purgeService);
        var req = TestRequest.For(userId, body: new
        {
            Title = "Second set",
            Items = new[] { new { GroupTuneId = groupTune.GroupTuneId, Repetitions = 2 } },
        });

        var result = await handler.UpdateGroupSet(req, groupSet.GroupSetId);

        Assert.IsType<OkObjectResult>(result);
        Assert.Contains($"/api/groupsets/{groupSet.GroupSetId}", recorder.PurgedPaths);
        Assert.Contains($"/api/groups/{groupId}/sets", recorder.PurgedPaths);
    }

    [Fact]
    public async Task DeleteGroupSet_PurgesTheSetAndTheGroupsList()
    {
        using var db = SetCacheTestDb.Create();
        var (userId, groupId, _, groupSet) = await SeedGroupSetAsync(db);

        var recorder = PurgeRecorder.Create(out var purgeService);
        var handler = new SessionApp.Api.Functions.GroupSets.ByGroupSetId.Delete(db, purgeService);

        var result = await handler.DeleteGroupSet(TestRequest.For(userId), groupSet.GroupSetId);

        Assert.IsType<NoContentResult>(result);
        Assert.Contains($"/api/groupsets/{groupSet.GroupSetId}", recorder.PurgedPaths);
        Assert.Contains($"/api/groups/{groupId}/sets", recorder.PurgedPaths);
    }

    [Fact]
    public async Task UpdateGroupTuneSetting_PurgesEverySetShowingThatTune()
    {
        using var db = SetCacheTestDb.Create();
        var (userId, groupId, groupTune, groupSet) = await SeedGroupSetAsync(db);

        var recorder = PurgeRecorder.Create(out var purgeService);
        var handler = new SessionApp.Api.Functions.Groups.ByGroupId.Tunes.ByGroupTuneId.Patch(db, purgeService);

        var result = await handler.UpdateGroupTune(
            TestRequest.For(userId, body: new { TuneSettingId = (Guid?)null }), groupId, groupTune.GroupTuneId);

        Assert.IsType<OkObjectResult>(result);
        Assert.Contains($"/api/groupsets/{groupSet.GroupSetId}", recorder.PurgedPaths);
    }

    [Fact]
    public async Task RemoveGroupTune_DropsItFromSetsRenumbersTheRestAndPurgesThem()
    {
        using var db = SetCacheTestDb.Create();
        var (userId, groupId, firstTune, groupSet) = await SeedGroupSetAsync(db);

        // Two more tunes after it, so the re-numbering has something to close up.
        var second = AddGroupTune(db, groupId, AddTune(db, "The Butterfly"), userId);
        var third = AddGroupTune(db, groupId, AddTune(db, "Out on the Ocean"), userId);
        db.GroupSetItems.Add(new GroupSetItem { GroupSetId = groupSet.GroupSetId, GroupTuneId = second.GroupTuneId, SequenceNumber = 2 });
        db.GroupSetItems.Add(new GroupSetItem { GroupSetId = groupSet.GroupSetId, GroupTuneId = third.GroupTuneId, SequenceNumber = 3 });
        await db.SaveChangesAsync();

        var recorder = PurgeRecorder.Create(out var purgeService);
        var handler = new SessionApp.Api.Functions.Groups.ByGroupId.Tunes.ByGroupTuneId.Delete(db, purgeService);

        var result = await handler.RemoveGroupTune(TestRequest.For(userId), groupId, firstTune.GroupTuneId);

        Assert.IsType<NoContentResult>(result);
        Assert.Contains($"/api/groupsets/{groupSet.GroupSetId}", recorder.PurgedPaths);
        Assert.Contains($"/api/groups/{groupId}/sets", recorder.PurgedPaths);

        var remaining = await db.GroupSetItems
            .Where(gsi => gsi.GroupSetId == groupSet.GroupSetId)
            .OrderBy(gsi => gsi.SequenceNumber)
            .ToListAsync();
        Assert.Equal(new[] { second.GroupTuneId, third.GroupTuneId }, remaining.Select(i => i.GroupTuneId));
        Assert.Equal(new[] { 1, 2 }, remaining.Select(i => i.SequenceNumber));
    }

    [Fact]
    public async Task GroupSetStillReadsAfterOneOfItsTunesLeavesTheGroup()
    {
        using var db = SetCacheTestDb.Create();
        var (userId, groupId, groupTune, groupSet) = await SeedGroupSetAsync(db);
        var keeper = AddGroupTune(db, groupId, AddTune(db, "The Butterfly"), userId);
        db.GroupSetItems.Add(new GroupSetItem { GroupSetId = groupSet.GroupSetId, GroupTuneId = keeper.GroupTuneId, SequenceNumber = 2 });
        await db.SaveChangesAsync();

        PurgeRecorder.Create(out var purgeService);
        var handler = new SessionApp.Api.Functions.Groups.ByGroupId.Tunes.ByGroupTuneId.Delete(db, purgeService);
        await handler.RemoveGroupTune(TestRequest.For(userId), groupId, groupTune.GroupTuneId);

        // The item left behind used to fail the id stitch and take the whole read down with it.
        var read = await GroupSetSupport.LoadedSetResultAsync(db, Analyzer, groupSet.GroupSetId, userId);

        Assert.IsType<OkObjectResult>(read);
    }

    [Fact]
    public async Task ModeratorTuneEdit_PurgesThePersonalAndGroupSetsHoldingIt()
    {
        using var db = SetCacheTestDb.Create();
        var (userId, groupId, groupTune, groupSet) = await SeedGroupSetAsync(db);

        // The same tune, also in the moderator's own repertoire and one of their sets.
        var tune = await db.Tunes.SingleAsync(t => t.TuneId == groupTune.TuneId);
        var userTune = AddUserTune(db, userId, tune);
        var set = new Set { SetId = Guid.NewGuid(), UserId = userId, Title = "Monday" };
        db.Sets.Add(set);
        db.SetItems.Add(new SetItem { SetId = set.SetId, UserTuneId = userTune.UserTuneId, SequenceNumber = 1 });
        await db.SaveChangesAsync();

        var recorder = PurgeRecorder.Create(out var purgeService);
        var handler = new SessionApp.Api.Functions.Moderator.Tunes.ByTuneId.Put(db, new TuneHeuristics(), purgeService);
        var req = TestRequest.For(userId, moderator: true, body: new
        {
            Title = "The Kesh (renamed)",
            TuneType = "Jig",
            Key = "Gmaj",
            MasterAbcText = "X:1\nK:G\nGAB|",
        });

        var result = await handler.ModeratorUpdateTune(req, tune.TuneId);

        Assert.IsType<OkObjectResult>(result);
        Assert.Contains($"/api/tunes/{tune.TuneId}", recorder.PurgedPaths);
        Assert.Contains($"/api/sets/{set.SetId}", recorder.PurgedPaths);
        Assert.Contains($"/api/groupsets/{groupSet.GroupSetId}", recorder.PurgedPaths);
    }

    private static GroupTune AddGroupTune(AppDb db, Guid groupId, Tune tune, Guid addedByUserId)
    {
        var groupTune = new GroupTune
        {
            GroupTuneId = Guid.NewGuid(),
            GroupId = groupId,
            TuneId = tune.TuneId,
            AddedByUserId = addedByUserId,
        };
        db.GroupTunes.Add(groupTune);
        return groupTune;
    }

    /// <summary>An owner, their group, one tune on its master list, and a set list holding that tune.</summary>
    private static async Task<(Guid UserId, Guid GroupId, GroupTune GroupTune, GroupSet GroupSet)> SeedGroupSetAsync(AppDb db)
    {
        var userId = Guid.NewGuid();
        AddUser(db, userId);

        var groupId = Guid.NewGuid();
        db.Groups.Add(new Group { GroupId = groupId, Name = "The Session" });
        db.GroupMemberships.Add(new GroupMembership
        {
            GroupId = groupId,
            UserId = userId,
            Role = GroupRole.Owner,
            Status = GroupMembershipStatus.Active,
        });

        var groupTune = AddGroupTune(db, groupId, AddTune(db), userId);
        var groupSet = new GroupSet { GroupSetId = Guid.NewGuid(), GroupId = groupId, Title = "First set" };
        db.GroupSets.Add(groupSet);
        db.GroupSetItems.Add(new GroupSetItem { GroupSetId = groupSet.GroupSetId, GroupTuneId = groupTune.GroupTuneId, SequenceNumber = 1 });
        await db.SaveChangesAsync();

        return (userId, groupId, groupTune, groupSet);
    }
}
