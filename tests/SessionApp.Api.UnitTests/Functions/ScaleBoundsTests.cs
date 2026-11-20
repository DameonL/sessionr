extern alias publicapi;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Functions;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using SessionApp.Api.TestSupport;
using PublicHttpCachingMiddleware = publicapi::SessionApp.Api.Functions.PublicHttpCachingMiddleware;

namespace SessionApp.Api.UnitTests.Functions;

public class ScaleBoundsTests
{
    private static AppDbContext CreateInMemoryDb(out SqliteConnection connection)
    {
        connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection)
            .Options;
        var db = new AppDbContext(options);
        db.Database.EnsureCreated();
        return db;
    }

    [Fact]
    public void PublicHttpCachingMiddleware_UsesShortSMaxAgeForTuneListAndLongForTuneDetail()
    {
        var listHeader = PublicHttpCachingMiddleware.ResolvePublicCacheControl(new PathString("/api/tunes"));
        var detailHeader = PublicHttpCachingMiddleware.ResolvePublicCacheControl(new PathString($"/api/tunes/{Guid.NewGuid()}"));

        Assert.Contains("s-maxage=300", listHeader);
        Assert.Contains("s-maxage=2592000", detailHeader);
    }

    [Fact]
    public async Task GetUnreviewedTunes_PaginatesAndReportsTotalCount()
    {
        using var db = CreateInMemoryDb(out var conn);
        await using var _ = conn;

        var baseTime = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        for (var i = 0; i < 5; i++)
        {
            db.Tunes.Add(new Tune
            {
                Title = $"Pending {i}",
                TuneType = TuneType.Reel,
                Key = "D",
                MasterAbcText = "K:D\nDEFG|",
                IsReviewed = false,
                CreatedAt = baseTime.AddMinutes(i),
            });
        }
        db.Tunes.Add(new Tune
        {
            Title = "Already Reviewed",
            TuneType = TuneType.Reel,
            Key = "D",
            MasterAbcText = "K:D\nDEFG|",
            IsReviewed = true,
            CreatedAt = baseTime.AddMinutes(10),
        });
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        var handler = new SessionApp.Api.Functions.Moderator.UnreviewedTunes.Get(db);
        var req1 = TestRequest.For(Guid.NewGuid(), moderator: true, query: new Dictionary<string, string>
        {
            ["page"] = "1",
            ["pageSize"] = "2",
        });
        var page1 = Assert.IsType<PagedResult<SessionApp.Api.Functions.Moderator.UnreviewedTunes.Get.ModeratorTuneDto>>(
            Assert.IsType<OkObjectResult>(await handler.GetUnreviewedTunes(req1)).Value);

        Assert.Equal(5, page1.TotalCount);
        Assert.True(page1.HasMore);
        Assert.Equal(["Pending 4", "Pending 3"], page1.Items.Select(t => t.Title));

        var req3 = TestRequest.For(Guid.NewGuid(), moderator: true, query: new Dictionary<string, string>
        {
            ["page"] = "3",
            ["pageSize"] = "2",
        });
        var page3 = Assert.IsType<PagedResult<SessionApp.Api.Functions.Moderator.UnreviewedTunes.Get.ModeratorTuneDto>>(
            Assert.IsType<OkObjectResult>(await handler.GetUnreviewedTunes(req3)).Value);

        Assert.False(page3.HasMore);
        Assert.Equal(["Pending 0"], page3.Items.Select(t => t.Title));
    }

    [Fact]
    public async Task GetUnreviewedAndAllModeratorGroups_PaginateCleanly()
    {
        using var db = CreateInMemoryDb(out var conn);
        await using var _ = conn;

        var baseTime = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        for (var i = 0; i < 4; i++)
        {
            db.Groups.Add(new Group
            {
                Name = $"Group {i}",
                Description = "Desc",
                IsReviewed = i == 3,
                CreatedAt = baseTime.AddMinutes(i),
            });
        }
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        var unreviewedHandler = new SessionApp.Api.Functions.Moderator.UnreviewedGroups.Get(db);
        var unreviewedRes = Assert.IsType<PagedResult<SessionApp.Api.Functions.Moderator.UnreviewedGroups.Get.ModeratorGroupDto>>(
            Assert.IsType<OkObjectResult>(await unreviewedHandler.GetUnreviewedGroups(
                TestRequest.For(Guid.NewGuid(), moderator: true, query: new Dictionary<string, string>
                {
                    ["page"] = "1",
                    ["pageSize"] = "2",
                }))).Value);

        Assert.Equal(3, unreviewedRes.TotalCount);
        Assert.True(unreviewedRes.HasMore);
        Assert.Equal(["Group 2", "Group 1"], unreviewedRes.Items.Select(g => g.Name));

        var allHandler = new SessionApp.Api.Functions.Moderator.Groups.Get(db);
        var allRes = Assert.IsType<PagedResult<SessionApp.Api.Functions.Moderator.UnreviewedGroups.Get.ModeratorGroupDto>>(
            Assert.IsType<OkObjectResult>(await allHandler.GetModeratorGroups(
                TestRequest.For(Guid.NewGuid(), moderator: true, query: new Dictionary<string, string>
                {
                    ["page"] = "2",
                    ["pageSize"] = "2",
                }))).Value);

        Assert.Equal(4, allRes.TotalCount);
        Assert.False(allRes.HasMore);
        Assert.Equal(["Group 1", "Group 0"], allRes.Items.Select(g => g.Name));
    }

    [Fact]
    public async Task RecomputeTuneHeuristics_ProcessesMultipleIdChunksWithoutSkippingRows()
    {
        using var db = CreateInMemoryDb(out var conn);
        await using var _ = conn;

        for (var i = 0; i < 125; i++)
        {
            var tune = new Tune
            {
                Title = $"Tune {i}",
                TuneType = TuneType.Reel,
                Key = "D",
                MasterAbcText = "X:1\nT:Test\nR:reel\nM:4/4\nL:1/8\nK:D\n|:DEFG ABcd:|",
            };
            db.Tunes.Add(tune);
            db.TuneSettings.Add(new TuneSetting
            {
                TuneId = tune.TuneId,
                Key = "D",
                AbcText = tune.MasterAbcText,
                SubmitterName = "Test",
            });
        }
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        var handler = new SessionApp.Api.Functions.Moderator.Tunes.RecomputeHeuristics.Post(db, new TuneHeuristics());
        var result = Assert.IsType<SessionApp.Api.Functions.Moderator.Tunes.RecomputeHeuristics.Post.RecomputeResult>(
            Assert.IsType<OkObjectResult>(await handler.RecomputeTuneHeuristics(TestRequest.For(Guid.NewGuid(), moderator: true))).Value);

        Assert.Equal(125, result.TunesUpdated);
        Assert.Equal(125, result.SettingsUpdated);
        Assert.All(await db.Tunes.AsNoTracking().ToListAsync(TestContext.Current.CancellationToken), t => Assert.False(string.IsNullOrEmpty(t.FingerprintIntervals)));
        Assert.All(await db.TuneSettings.AsNoTracking().ToListAsync(TestContext.Current.CancellationToken), s => Assert.False(string.IsNullOrEmpty(s.FingerprintIntervals)));
    }

    [Fact]
    public async Task RepertoireTuneIdsAndSummary_ReturnOnlyCallersDistinctIdsAndPinnedKeys()
    {
        using var db = CreateInMemoryDb(out var conn);
        await using var _ = conn;

        var userA = new User { DisplayName = "User A", Email = "a@example.com" };
        var userB = new User { DisplayName = "User B", Email = "b@example.com" };
        var tune1 = new Tune { Title = "The Kesh", TuneType = TuneType.Jig, Key = "G", MasterAbcText = "K:G\nGAB|", Difficulty = 12 };
        var tune2 = new Tune { Title = "Cooley's", TuneType = TuneType.Reel, Key = "Edor", MasterAbcText = "K:Edor\nEBBA|", Difficulty = 34 };
        var setting2 = new TuneSetting { TuneId = tune2.TuneId, Key = "Ador", AbcText = "K:Ador\nEAAB|" };

        db.Users.AddRange(userA, userB);
        db.Tunes.AddRange(tune1, tune2);
        db.TuneSettings.Add(setting2);
        db.UserTunes.AddRange(
            new UserTune { UserId = userA.UserId, TuneId = tune1.TuneId, Status = TuneStatus.Active },
            new UserTune { UserId = userA.UserId, TuneId = tune2.TuneId, TuneSettingId = setting2.TuneSettingId, Status = TuneStatus.Learning },
            new UserTune { UserId = userB.UserId, TuneId = tune2.TuneId, Status = TuneStatus.Active });
        await db.SaveChangesAsync(TestContext.Current.CancellationToken);

        var idsHandler = new SessionApp.Api.Functions.Repertoire.TuneIds.Get(db);
        var ids = Assert.IsType<List<Guid>>(
            Assert.IsType<OkObjectResult>(await idsHandler.GetRepertoireTuneIds(TestRequest.For(userA.UserId))).Value);
        Assert.Equal(2, ids.Count);
        Assert.Contains(tune1.TuneId, ids);
        Assert.Contains(tune2.TuneId, ids);

        var repHandler = new SessionApp.Api.Functions.Repertoire.Get(db);
        var summaryPage = Assert.IsType<PagedResult<RepertoireListItemDto>>(
            Assert.IsType<OkObjectResult>(await repHandler.GetRepertoire(
                TestRequest.For(userA.UserId, query: new Dictionary<string, string> { ["summary"] = "true" }))).Value);

        Assert.Equal(2, summaryPage.TotalCount);
        Assert.Equal(["Cooley's", "The Kesh"], summaryPage.Items.Select(i => i.Title));
        Assert.Equal("Ador", summaryPage.Items[0].Key);
        Assert.Equal(34, summaryPage.Items[0].Difficulty);
        Assert.Equal("G", summaryPage.Items[1].Key);
    }
}
