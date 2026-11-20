using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using SessionApp.Api.Data;
using SessionApp.Api.Functions;
using SessionApp.Api.Models;
using SessionApp.Api.Services;

namespace SessionApp.Api.UnitTests.Services;

public class TheSessionDataMigrationServiceTests
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

    private sealed class StubHttpClientFactory(Func<HttpRequestMessage, HttpResponseMessage> responder) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new StubHandler(responder));

        private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
        {
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
                => Task.FromResult(responder(request));
        }
    }

    private static TheSessionDataMigrationService CreateService(AppDbContext db, string jsonPayload)
    {
        var factory = new StubHttpClientFactory(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json"),
        });
        var cache = new TheSessionDatasetCache(factory);
        return new TheSessionDataMigrationService(db, cache, new TuneHeuristics());
    }

    [Theory]
    [InlineData("Silver Spear, The", "The Silver Spear")]
    [InlineData("  Banshee,   The ", "The Banshee")]
    [InlineData("Further, The Deeper, The", "The Further, The Deeper")]
    [InlineData("Cooley's", "Cooley's")]
    [InlineData("Maid Behind The Bar, A", "A Maid Behind The Bar")]
    public void NormalizeTitle_ConvertsTrailingArticlesToLeading(string raw, string expected)
    {
        Assert.Equal(expected, TheSessionDataTransformer.NormalizeTitle(raw));
    }

    [Fact]
    public void BuildTuneGroups_PreservesDecorationsDeduplicatesSettingsAndOrdersCanonicalFirst()
    {
        var records = new[]
        {
            // Higher setting_id comes first in JSON; lower setting_id (1) should become canonical.
            new TheSessionBulkSettingRecord(
                "1", "21423", "Cooley's", "reel", "4/4", "Eminor",
                "|:EBBA B2!slide!EB:|", "2012-01-01", "Alice", ""),
            new TheSessionBulkSettingRecord(
                "1", "1", "Cooley's", "reel", "4/4", "Edorian",
                "|:D2|EBBA B2 EB|\r\nB2 AB dBAG:|", "2001-01-01", "Jeremy", "Joe Cooley"),
            // Exact duplicate setting_id in dump should be ignored.
            new TheSessionBulkSettingRecord(
                "1", "1", "Cooley's", "reel", "4/4", "Edorian",
                "|:D2|EBBA B2 EB|\r\nB2 AB dBAG:|", "2001-01-01", "Jeremy", "Joe Cooley"),
            new TheSessionBulkSettingRecord(
                "182", "182", "Silver Spear, The", "reel", "4/4", "Dmajor",
                "|:FAAB AFED:|", "2001-02-01", "Bob", ""),
        };

        var groups = TheSessionDataTransformer.BuildTuneGroups(records);

        Assert.Equal(2, groups.Count);
        Assert.Equal(1, groups[0].TuneId);
        Assert.Equal(1, groups[0].CanonicalSettingId);
        Assert.Equal("Edor", groups[0].Key);
        Assert.Equal(2, groups[0].Settings.Count);
        Assert.Contains("C:Joe Cooley\n", groups[0].MasterAbcText);
        // !slide! decoration must NOT be turned into a newline.
        Assert.Contains("!slide!", groups[0].Settings[1].FullAbc);

        Assert.Equal(182, groups[1].TuneId);
        Assert.Equal("The Silver Spear", groups[1].Title);
        Assert.Equal("D", groups[1].Key);
    }

    [Fact]
    public async Task MigrateBatchAsync_DeduplicatesExistingTunesBackfillsIdsAndAddsMissingSettings()
    {
        using var db = CreateInMemoryDb(out var conn);
        await using var _ = conn;
        var ct = TestContext.Current.CancellationToken;

        // 1) Pre-existing tune imported via REST API (has TheSessionId, 1 System setting without TheSessionSettingId).
        var cooleys = new Tune
        {
            Title = "Cooley's",
            TheSessionId = 1,
            TuneType = TuneType.Reel,
            Key = "Edor",
            MasterAbcText = "X:1\nT:Cooley's\nR:reel\nM:4/4\nL:1/8\nK:Edor\n|:D2|EBBA B2 EB:|",
            IsReviewed = true,
        };
        db.Tunes.Add(cooleys);
        db.TuneSettings.Add(new TuneSetting
        {
            TuneId = cooleys.TuneId,
            Key = "Edor",
            AbcText = cooleys.MasterAbcText,
            SubmitterName = "System",
            VoteScore = 3,
        });

        // 2) Pre-existing seeded/manual tune with TheSessionId == null, matching by normalized Title + Key.
        var silverSpear = new Tune
        {
            Title = "The Silver Spear",
            TheSessionId = null,
            TuneType = TuneType.Reel,
            Key = "D",
            MasterAbcText = "X:1\nT:The Silver Spear\nR:reel\nM:4/4\nL:1/8\nK:D\n|:CUSTOM_SEEDED:|",
            IsReviewed = true,
        };
        db.Tunes.Add(silverSpear);
        db.TuneSettings.Add(new TuneSetting
        {
            TuneId = silverSpear.TuneId,
            Key = "D",
            AbcText = silverSpear.MasterAbcText,
            SubmitterName = "System",
            VoteScore = 3,
        });
        await db.SaveChangesAsync(ct);

        var dump = new[]
        {
            // Canonical + 1 new alternate setting for Cooley's (tune 1).
            new
            {
                tune_id = "1", setting_id = "1", name = "Cooley's", type = "reel", meter = "4/4",
                mode = "Edorian", abc = "|:D2|EBBA B2 EB:|", date = "2001-01-01", username = "Jeremy", composer = ""
            },
            new
            {
                tune_id = "1", setting_id = "21423", name = "Cooley's", type = "reel", meter = "4/4",
                mode = "Eminor", abc = "|:EBBA B2 EB|B2 AB dBAG:|", date = "2012-01-01", username = "Alice", composer = ""
            },
            // Seeded tune without TheSessionId (tune 182): title has trailing ", The".
            new
            {
                tune_id = "182", setting_id = "182", name = "Silver Spear, The", type = "reel", meter = "4/4",
                mode = "Dmajor", abc = "|:FAAB AFED|FAAB ABde:|", date = "2001-02-01", username = "Bob", composer = ""
            },
            // Brand-new tune (tune 26102).
            new
            {
                tune_id = "26102", setting_id = "55813", name = "'Ma' McNulty's Favourite", type = "hornpipe", meter = "4/4",
                mode = "Edorian", abc = "B2 E>F G>A B2|\r\ne2 d>f e>dB>c||", date = "2025-11-13", username = "The Archivist", composer = "Trad"
            },
        };

        var service = CreateService(db, JsonSerializer.Serialize(dump));

        // First batch of 2 tunes (tune 1 & tune 182)
        var batch1 = await service.MigrateBatchAsync(new MigrateTheSessionRequest(AfterTuneId: 0, BatchSize: 2), ct);
        Assert.Equal(3, batch1.TotalTunesInSource);
        Assert.Equal(2, batch1.ProcessedInBatch);
        Assert.Equal(1, batch1.RemainingTunes);
        Assert.Equal(182, batch1.NextAfterTuneId);
        Assert.True(batch1.HasMore);
        Assert.Equal(0, batch1.TunesCreated);
        Assert.Equal(2, batch1.TunesSkippedExisting);
        Assert.Equal(1, batch1.TunesBackfilledId);
        Assert.Equal(1, batch1.SettingsCreated); // alternate setting 21423 for Cooley's
        Assert.Equal(2, batch1.SettingsSkipped); // canonical settings 1 & 182 matched existing System settings

        // Second batch (tune 26102)
        var batch2 = await service.MigrateBatchAsync(new MigrateTheSessionRequest(AfterTuneId: batch1.NextAfterTuneId, BatchSize: 2), ct);
        Assert.Equal(1, batch2.ProcessedInBatch);
        Assert.Equal(0, batch2.RemainingTunes);
        Assert.False(batch2.HasMore);
        Assert.Equal(1, batch2.TunesCreated);
        Assert.Equal(1, batch2.SettingsCreated);

        // Verify Silver Spear preserved its existing MasterAbcText and gained TheSessionId = 182.
        var reloadedSilver = await db.Tunes.SingleAsync(t => t.TuneId == silverSpear.TuneId, ct);
        Assert.Equal(182, reloadedSilver.TheSessionId);
        Assert.Contains("CUSTOM_SEEDED", reloadedSilver.MasterAbcText);

        // Verify newly created tune is reviewed, fingerprinted, and has VoteScore = 3 on canonical setting.
        var newTune = await db.Tunes.SingleAsync(t => t.TheSessionId == 26102, ct);
        Assert.True(newTune.IsReviewed);
        Assert.Equal(TheSessionDataMigrationService.MigrationReviewerName, newTune.ReviewedBy);
        Assert.Equal(TuneType.Hornpipe, newTune.TuneType);
        Assert.Equal("Edor", newTune.Key);
        Assert.True(newTune.NoteCount > 0);
        Assert.False(string.IsNullOrEmpty(newTune.FingerprintIntervals));

        var newSetting = await db.TuneSettings.SingleAsync(s => s.TuneId == newTune.TuneId, ct);
        Assert.Equal(55813, newSetting.TheSessionSettingId);
        Assert.Equal("The Archivist", newSetting.SubmitterName);
        Assert.Equal(3, newSetting.VoteScore);
        Assert.False(string.IsNullOrEmpty(newSetting.FingerprintIntervals));

        // Re-running from scratch must be completely idempotent (0 created).
        var rerun = await service.MigrateBatchAsync(new MigrateTheSessionRequest(AfterTuneId: 0, BatchSize: 50), ct);
        Assert.Equal(0, rerun.TunesCreated);
        Assert.Equal(0, rerun.TunesBackfilledId);
        Assert.Equal(0, rerun.SettingsCreated);
        Assert.Equal(3, rerun.TunesSkippedExisting);
        Assert.Equal(4, rerun.SettingsSkipped);
    }

    [Fact]
    public async Task MigrateBatchAsync_DryRun_DoesNotWriteToDatabase()
    {
        using var db = CreateInMemoryDb(out var conn);
        await using var _ = conn;
        var ct = TestContext.Current.CancellationToken;

        var dump = new[]
        {
            new
            {
                tune_id = "55", setting_id = "55", name = "Kesh", type = "jig", meter = "6/8",
                mode = "Gmajor", abc = "|:G3 GAB|ABA ABd:|", date = "2001-01-01", username = "Jeremy", composer = ""
            },
        };

        var service = CreateService(db, JsonSerializer.Serialize(dump));
        var result = await service.MigrateBatchAsync(
            new MigrateTheSessionRequest(AfterTuneId: 0, BatchSize: 50, DryRun: true), ct);

        Assert.Equal(1, result.TunesCreated);
        Assert.Equal(1, result.SettingsCreated);
        Assert.Equal(0, await db.Tunes.CountAsync(ct));
        Assert.Equal(0, await db.TuneSettings.CountAsync(ct));
    }
}
