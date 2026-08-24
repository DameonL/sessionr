using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;

namespace SessionApp.Api.UnitTests.Services;

/// <summary>
/// The index is a cache over the tune library, not a query: it reads every fingerprint once and
/// then scores entirely in memory. That makes an in-memory SQLite database an honest stand-in here
/// — the Cosmos-specific query behaviour it depends on is covered by the integration suite.
/// </summary>
public class TuneMatchIndexTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly ServiceProvider _services;
    private readonly TuneHeuristics _heuristics = new();

    public TuneMatchIndexTests()
    {
        // Held open for the lifetime of the test: an in-memory SQLite database exists
        // only while at least one connection to it does.
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

    private TuneMatchIndex NewIndex() => new(_services.GetRequiredService<IServiceScopeFactory>());

    private Tune AddTune(string title, string abc, string key = "D", TuneType type = TuneType.Reel)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var tune = new Tune { Title = title, Key = key, TuneType = type, MasterAbcText = abc };
        _heuristics.Apply(tune);
        db.Tunes.Add(tune);
        db.SaveChanges();
        return tune;
    }

    private void AddSetting(Guid tuneId, string abc, string key = "D")
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var probe = new Tune { MasterAbcText = abc, Key = key, TuneType = TuneType.Reel };
        _heuristics.Apply(probe);

        db.TuneSettings.Add(new TuneSetting
        {
            TuneId = tuneId,
            Key = key,
            AbcText = abc,
            SubmitterName = "Test",
            FingerprintIntervals = probe.FingerprintIntervals,
        });
        db.SaveChanges();
    }

    private int[] FingerprintOf(string abc, string key = "D")
    {
        var probe = new Tune { MasterAbcText = abc, Key = key, TuneType = TuneType.Reel };
        _heuristics.Apply(probe);
        return MelodyFingerprint.ParseIntervalString(probe.FingerprintIntervals);
    }

    private const string CooleysAbc = "K:Edor\nEBBA B2EB|B2AB dBAG|FDAD BDAD|FDAD dAGF|";
    private const string DrowsyMaggieAbc = "K:Edor\nEBBA B2EB|B2AB defg|afec dBAF|DEFD E2ge|";
    private const string BankOfIrelandAbc = "K:G\nGABc dedB|dedB dedB|GABc dedB|c2A2 AGEG|";

    [Fact]
    public async Task MatchAsync_AnEmptyLibraryYieldsNothing()
    {
        var result = await NewIndex().MatchAsync(FingerprintOf(CooleysAbc));

        Assert.Empty(result);
    }

    [Fact]
    public async Task MatchAsync_AnEmptyQueryYieldsNothing()
    {
        AddTune("Cooley's", CooleysAbc);

        Assert.Empty(await NewIndex().MatchAsync([]));
    }

    [Fact]
    public async Task MatchAsync_FindsTheTuneItWasPlayedFrom()
    {
        var cooleys = AddTune("Cooley's", CooleysAbc);
        AddTune("Drowsy Maggie", DrowsyMaggieAbc);
        AddTune("The Bank of Ireland", BankOfIrelandAbc);

        var result = await NewIndex().MatchAsync(FingerprintOf(CooleysAbc));

        Assert.Equal(cooleys.TuneId, result[0].TuneId);
        Assert.Equal("Cooley's", result[0].Title);
        Assert.Equal(100, result[0].Confidence);
    }

    [Fact]
    public async Task MatchAsync_IdentifiesATuneFromAShortExcerptOfIt()
    {
        var cooleys = AddTune("Cooley's", CooleysAbc);
        AddTune("Drowsy Maggie", DrowsyMaggieAbc);
        AddTune("The Bank of Ireland", BankOfIrelandAbc);

        // Only the second bar, as if the player joined halfway in.
        var result = await NewIndex().MatchAsync(FingerprintOf("K:Edor\nB2AB dBAG"));

        Assert.Equal(cooleys.TuneId, result[0].TuneId);
        Assert.True(result[0].Confidence > MelodyFingerprint.ConfidenceThresholdPercent);
    }

    [Fact]
    public async Task MatchAsync_IdentifiesATunePlayedInADifferentKey()
    {
        // The fingerprint is interval-based, so the same tune a tone up still matches.
        var cooleys = AddTune("Cooley's", CooleysAbc);
        AddTune("The Bank of Ireland", BankOfIrelandAbc);

        var transposed = FingerprintOf("K:F#dor\nF#c#c#B c#2F#c#|c#2Bc# ec#BA");
        var result = await NewIndex().MatchAsync(transposed);

        Assert.Equal(cooleys.TuneId, result[0].TuneId);
    }

    [Fact]
    public async Task MatchAsync_RanksTheRightTuneAboveTheOthers()
    {
        AddTune("Cooley's", CooleysAbc);
        var maggie = AddTune("Drowsy Maggie", DrowsyMaggieAbc);
        AddTune("The Bank of Ireland", BankOfIrelandAbc);

        var result = await NewIndex().MatchAsync(FingerprintOf(DrowsyMaggieAbc));

        Assert.Equal(maggie.TuneId, result[0].TuneId);
        Assert.True(result.Count < 2 || result[0].Confidence >= result[1].Confidence);
    }

    [Fact]
    public async Task MatchAsync_ReturnsResultsInDescendingConfidence()
    {
        AddTune("Cooley's", CooleysAbc);
        AddTune("Drowsy Maggie", DrowsyMaggieAbc);
        AddTune("The Bank of Ireland", BankOfIrelandAbc);

        var result = await NewIndex().MatchAsync(FingerprintOf(CooleysAbc));

        Assert.Equal([.. result.Select(r => r.Confidence).OrderDescending()], result.Select(r => r.Confidence));
    }

    [Fact]
    public async Task MatchAsync_HonoursTopN()
    {
        for (var i = 0; i < 6; i++)
        {
            AddTune($"Variant {i}", CooleysAbc);
        }

        Assert.Equal(2, (await NewIndex().MatchAsync(FingerprintOf(CooleysAbc), topN: 2)).Count);
    }

    [Fact]
    public async Task MatchAsync_ReportsATunesBestSettingRatherThanOneRowPerSetting()
    {
        var cooleys = AddTune("Cooley's", CooleysAbc);
        AddSetting(cooleys.TuneId, CooleysAbc);
        AddSetting(cooleys.TuneId, DrowsyMaggieAbc); // a wildly divergent "setting"

        var result = await NewIndex().MatchAsync(FingerprintOf(CooleysAbc));

        Assert.Single(result);
        Assert.Equal(cooleys.TuneId, result[0].TuneId);
    }

    [Fact]
    public async Task MatchAsync_PointsAtTheSettingThatActuallyMatched()
    {
        // The master ABC is one tune; a submitted setting is a different melody. Playing
        // the setting must surface the tune *and* name the setting that matched.
        var tune = AddTune("Two Faces", CooleysAbc);
        AddSetting(tune.TuneId, DrowsyMaggieAbc);

        var result = await NewIndex().MatchAsync(FingerprintOf(DrowsyMaggieAbc));

        Assert.Equal(tune.TuneId, result[0].TuneId);
        Assert.NotNull(result[0].MatchedTuneSettingId);
    }

    [Fact]
    public async Task MatchAsync_LeavesTheSettingIdNullWhenTheMasterAbcIsWhatMatched()
    {
        var tune = AddTune("Cooley's", CooleysAbc);
        AddSetting(tune.TuneId, DrowsyMaggieAbc);

        var result = await NewIndex().MatchAsync(FingerprintOf(CooleysAbc));

        Assert.Null(result[0].MatchedTuneSettingId);
    }

    [Fact]
    public async Task MatchAsync_SkipsTunesWithNoFingerprintYet()
    {
        AddTune("Cooley's", CooleysAbc);

        using (var scope = _services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Tunes.Add(new Tune { Title = "Never Analysed", Key = "D", MasterAbcText = "K:D\nDEFG" });
            db.SaveChanges(); // FingerprintIntervals left null
        }

        var result = await NewIndex().MatchAsync(FingerprintOf(CooleysAbc));

        Assert.DoesNotContain(result, r => r.Title == "Never Analysed");
    }

    [Theory]
    [InlineData(" ")]
    [InlineData("")]
    [InlineData("1,,2")]
    [InlineData("2,-3,")]
    [InlineData("1,x,2")]
    public async Task MatchAsync_SurvivesAMalformedStoredFingerprint(string fingerprint)
    {
        AddTune("Cooley's", CooleysAbc);

        using (var scope = _services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Tunes.Add(new Tune
            {
                Title = "Corrupt Fingerprint",
                Key = "D",
                MasterAbcText = "K:D\nDEFG",
                FingerprintIntervals = fingerprint,
            });
            db.SaveChanges();
        }

        // The whole index rebuilds on this call, so a throw here would take out every match,
        // not just the one bad row — the real failure mode this guards against.
        var result = await NewIndex().MatchAsync(FingerprintOf(CooleysAbc));

        Assert.Contains(result, r => r.Title == "Cooley's");
    }

    [Fact]
    public async Task MatchAsync_AnUnrecognizableQueryReturnsNoConfidentMatch()
    {
        AddTune("Cooley's", CooleysAbc);
        AddTune("Drowsy Maggie", DrowsyMaggieAbc);

        int[] noise = [11, -7, 6, -11, 9, -6, 10, -9, 7, -10];
        var result = await NewIndex().MatchAsync(noise);

        Assert.True(result.All(r => r.Confidence < MelodyFingerprint.ConfidenceThresholdPercent),
            $"expected nothing confident, got [{string.Join(", ", result.Select(r => $"{r.Title} {r.Confidence}"))}]");
    }

    [Fact]
    public async Task MatchAsync_CarriesTheTuneMetadataNeededToRenderAResult()
    {
        var tune = AddTune("Cooley's", CooleysAbc, key: "Edor", type: TuneType.Reel);

        var match = (await NewIndex().MatchAsync(FingerprintOf(CooleysAbc)))[0];

        Assert.Equal(tune.Title, match.Title);
        Assert.Equal("Reel", match.TuneType);
        Assert.Equal("Edor", match.Key);
        Assert.Equal(tune.Difficulty, match.Difficulty);
    }

    [Fact]
    public async Task MatchAsync_ServesTheCachedSnapshotRatherThanRereadingTheLibrary()
    {
        AddTune("Cooley's", CooleysAbc);
        var index = NewIndex();
        await index.MatchAsync(FingerprintOf(CooleysAbc)); // builds the snapshot

        AddTune("Drowsy Maggie", DrowsyMaggieAbc);

        // The new tune is invisible until the 30-minute TTL lapses or a refresh is forced.
        var stale = await index.MatchAsync(FingerprintOf(DrowsyMaggieAbc));
        Assert.DoesNotContain(stale, r => r.Title == "Drowsy Maggie");
    }

    [Fact]
    public async Task ForceRefreshAsync_PicksUpLibraryChangesImmediately()
    {
        AddTune("Cooley's", CooleysAbc);
        var index = NewIndex();
        await index.MatchAsync(FingerprintOf(CooleysAbc));

        var maggie = AddTune("Drowsy Maggie", DrowsyMaggieAbc);
        await index.ForceRefreshAsync();

        var result = await index.MatchAsync(FingerprintOf(DrowsyMaggieAbc));
        Assert.Equal(maggie.TuneId, result[0].TuneId);
    }

    [Fact]
    public async Task ForceRefreshAsync_OnAnEmptyLibraryIsSafe()
    {
        var index = NewIndex();

        await index.ForceRefreshAsync();

        Assert.Empty(await index.MatchAsync(FingerprintOf(CooleysAbc)));
    }

    [Fact]
    public async Task MatchAsync_ConcurrentCallersOnAColdIndexAllGetTheSameAnswer()
    {
        var cooleys = AddTune("Cooley's", CooleysAbc);
        AddTune("Drowsy Maggie", DrowsyMaggieAbc);
        var index = NewIndex();
        var query = FingerprintOf(CooleysAbc);

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => index.MatchAsync(query)));

        Assert.All(results, r => Assert.Equal(cooleys.TuneId, r[0].TuneId));
    }
}
