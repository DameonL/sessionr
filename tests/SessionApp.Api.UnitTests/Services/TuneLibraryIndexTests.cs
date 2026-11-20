extern alias publicapi;

using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SessionApp.Api.Data;
using SessionApp.Api.Functions;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using SessionApp.Api.TestSupport;
using PublicTunesGet = publicapi::SessionApp.Api.Functions.Tunes.Get;

namespace SessionApp.Api.UnitTests.Services;

public class TuneLibraryIndexTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly ServiceProvider _services;

    public TuneLibraryIndexTests()
    {
        _connection = new SqliteConnection("Data Source=:memory:");
        _connection.Open();

        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(options => options.UseSqlite(_connection));
        _services = services.BuildServiceProvider();

        using var scope = _services.CreateScope();
        scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureCreated();
    }

    public void Dispose()
    {
        _services.Dispose();
        _connection.Dispose();
        GC.SuppressFinalize(this);
    }

    private TuneLibraryIndex NewIndex() => new(_services.GetRequiredService<IServiceScopeFactory>());

    private Tune AddTune(
        string title,
        TuneType type = TuneType.Reel,
        string key = "D",
        int repertoireCount = 0,
        int difficulty = 20,
        DateTime? createdAt = null)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var tune = new Tune
        {
            Title = title,
            TuneType = type,
            Key = key,
            MasterAbcText = "K:D\nDEFG|",
            RepertoireCount = repertoireCount,
            Difficulty = difficulty,
            CreatedAt = createdAt ?? DateTime.UtcNow,
        };
        db.Tunes.Add(tune);
        db.SaveChanges();
        return tune;
    }

    private void AddAlias(Guid tuneId, string aliasName)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.TuneAliases.Add(new TuneAlias { TuneId = tuneId, Name = aliasName });
        db.SaveChanges();
    }

    private void MarkTunesChanged()
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var stats = db.LibraryStats.FirstOrDefault(s => s.LibraryStatsId == LibraryStats.SingletonId);
        if (stats is null)
        {
            db.LibraryStats.Add(new LibraryStats { TuneCount = 0, TunesChangedAt = DateTime.UtcNow });
        }
        else
        {
            stats.TunesChangedAt = DateTime.UtcNow;
        }
        db.SaveChanges();
    }

    [Fact]
    public async Task SearchAsync_SortsByPopularNewestAndAlphabeticalWithArticleHandling()
    {
        var ct = TestContext.Current.CancellationToken;
        var baseTime = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        AddTune("The Banshee", TuneType.Reel, "G", repertoireCount: 15, createdAt: baseTime.AddMinutes(1));
        AddTune("Cooley's", TuneType.Reel, "Edor", repertoireCount: 42, createdAt: baseTime.AddMinutes(2));
        AddTune("A Abbots Bromley", TuneType.Jig, "Em", repertoireCount: 0, createdAt: baseTime.AddMinutes(3));

        var index = NewIndex();

        var popular = await index.SearchAsync(null, null, null, "popular", 1, 20, ct);
        Assert.Equal(["Cooley's", "The Banshee", "A Abbots Bromley"], popular.Items.Select(i => i.Title));

        var newest = await index.SearchAsync(null, null, null, "newest", 1, 20, ct);
        Assert.Equal(["A Abbots Bromley", "Cooley's", "The Banshee"], newest.Items.Select(i => i.Title));

        var alphabetical = await index.SearchAsync(null, null, null, "alphabetical", 1, 20, ct);
        // "A Abbots Bromley" sorts under "Abbots Bromley", "The Banshee" under "Banshee", "Cooley's" under "Cooley's".
        Assert.Equal(["A Abbots Bromley", "The Banshee", "Cooley's"], alphabetical.Items.Select(i => i.Title));
    }

    [Fact]
    public async Task SearchAsync_FiltersByTitleAliasTypeAndKeyAndPaginates()
    {
        var ct = TestContext.Current.CancellationToken;
        var kesh = AddTune("The Kesh", TuneType.Jig, "G", repertoireCount: 10);
        AddAlias(kesh.TuneId, "Kesh Jig");
        AddTune("Morrison's", TuneType.Jig, "Edor", repertoireCount: 25);
        AddTune("The Silver Spear", TuneType.Reel, "D", repertoireCount: 30);

        var index = NewIndex();

        var byAlias = await index.SearchAsync("kesh jig", null, null, "popular", 1, 20, ct);
        Assert.Single(byAlias.Items);
        Assert.Equal(kesh.TuneId, byAlias.Items[0].TuneId);

        var jigs = await index.SearchAsync(null, "Jig", null, "popular", 1, 1, ct);
        Assert.Equal(2, jigs.TotalCount);
        Assert.True(jigs.HasMore);
        Assert.Equal("Morrison's", Assert.Single(jigs.Items).Title);

        var jigsPage2 = await index.SearchAsync(null, "Jig", null, "popular", 2, 1, ct);
        Assert.Equal(2, jigsPage2.TotalCount);
        Assert.False(jigsPage2.HasMore);
        Assert.Equal("The Kesh", Assert.Single(jigsPage2.Items).Title);

        var byKey = await index.SearchAsync(null, null, "D", null, 1, 20, ct);
        Assert.Single(byKey.Items);
        Assert.Equal("The Silver Spear", byKey.Items[0].Title);
    }

    [Fact]
    public async Task SearchAsync_RefreshesWhenTunesChangedStampAdvances()
    {
        var ct = TestContext.Current.CancellationToken;
        AddTune("Cooley's", repertoireCount: 5);
        var index = NewIndex();

        var initial = await index.SearchAsync(null, null, null, "popular", 1, 20, ct);
        Assert.Equal(1, initial.TotalCount);

        AddTune("Drowsy Maggie", repertoireCount: 10);
        // Without stamping, snapshot stays cached.
        var cached = await index.SearchAsync(null, null, null, "popular", 1, 20, ct);
        Assert.Equal(1, cached.TotalCount);

        // Wait past StampCheckInterval? No — test ForceRefreshAsync and a fresh index noticing stamp.
        MarkTunesChanged();
        await index.ForceRefreshAsync(ct);

        var refreshed = await index.SearchAsync(null, null, null, "popular", 1, 20, ct);
        Assert.Equal(2, refreshed.TotalCount);
        Assert.Equal("Drowsy Maggie", refreshed.Items[0].Title);
    }

    [Fact]
    public async Task SearchTunesFunction_ClampsPagingAndReturnsPagedResult()
    {
        for (var i = 0; i < 5; i++)
        {
            AddTune($"Tune {i}", repertoireCount: i);
        }

        var handler = new PublicTunesGet(NewIndex());
        var req = TestRequest.Anonymous(query: new System.Collections.Generic.Dictionary<string, string>
        {
            ["sort"] = "popular",
            ["page"] = "0",
            ["pageSize"] = "2",
        });

        var result = await handler.SearchTunes(req);

        var ok = Assert.IsType<OkObjectResult>(result);
        var paged = Assert.IsType<PagedResult<TuneDto>>(ok.Value);
        Assert.Equal(5, paged.TotalCount);
        Assert.Equal(1, paged.Page);
        Assert.Equal(2, paged.PageSize);
        Assert.True(paged.HasMore);
        Assert.Equal(["Tune 4", "Tune 3"], paged.Items.Select(t => t.Title));
    }

    [Fact]
    public async Task SearchAsync_CanceledCallerDoesNotAbortSharedColdRebuild()
    {
        AddTune("Cooley's", repertoireCount: 10);
        var index = NewIndex();

        using var cts = new System.Threading.CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            index.SearchAsync(null, null, null, "popular", 1, 20, cts.Token));

        var healthy = await index.SearchAsync(null, null, null, "popular", 1, 20, TestContext.Current.CancellationToken);
        Assert.Single(healthy.Items);
        Assert.Equal("Cooley's", healthy.Items[0].Title);
    }
}
