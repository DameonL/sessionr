using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using SessionApp.Api.Data;
using SessionApp.Api.Functions;
using SessionApp.Api.Functions.Moderator.Tunes.MigrateTheSession;
using SessionApp.Api.Services;
using SessionApp.Api.TestSupport;

namespace SessionApp.Api.UnitTests.Functions;

public class MigrateTheSessionTests
{
    private sealed class StubHttpClientFactory(Func<HttpRequestMessage, HttpResponseMessage> responder) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new StubHandler(responder));

        private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
        {
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
                => Task.FromResult(responder(request));
        }
    }

    private static AppDbContext CreateInMemoryDb(out SqliteConnection connection)
    {
        connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;
        var db = new AppDbContext(options);
        db.Database.EnsureCreated();
        return db;
    }

    private static Post CreateHandler(AppDbContext db, string jsonPayload)
    {
        var factory = new StubHttpClientFactory(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json"),
        });
        var cache = new TheSessionDatasetCache(factory);
        var purge = new CloudflareCachePurgeService(new HttpClient(), NullLogger<CloudflareCachePurgeService>.Instance);
        var service = new TheSessionDataMigrationService(db, cache, new TuneHeuristics(), purge);
        return new Post(service, NullLogger<Post>.Instance);
    }

    [Fact]
    public async Task MigrateTheSessionTunes_NonModerator_ReturnsForbidden()
    {
        using var db = CreateInMemoryDb(out var conn);
        await using var _ = conn;
        var handler = CreateHandler(db, "[]");
        var req = TestRequest.For(Guid.NewGuid(), moderator: false);

        var result = await handler.MigrateTheSessionTunes(req);

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(403, obj.StatusCode);
    }

    [Fact]
    public async Task MigrateTheSessionTunes_NegativeAfterTuneId_ReturnsBadRequest()
    {
        using var db = CreateInMemoryDb(out var conn);
        await using var _ = conn;
        var handler = CreateHandler(db, "[]");
        var req = TestRequest.For(Guid.NewGuid(), moderator: true, body: new MigrateTheSessionRequest(AfterTuneId: -1));

        var result = await handler.MigrateTheSessionTunes(req);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task MigrateTheSessionTunes_ValidModeratorRequest_RunsBatchAndReturnsCounts()
    {
        using var db = CreateInMemoryDb(out var conn);
        await using var _ = conn;
        var payload = JsonSerializer.Serialize(new[]
        {
            new
            {
                tune_id = "1", setting_id = "1", name = "Cooley's", type = "reel", meter = "4/4",
                mode = "Edorian", abc = "|:D2|EBBA B2 EB:|", date = "2001-01-01", username = "Jeremy", composer = ""
            }
        });
        var handler = CreateHandler(db, payload);
        var req = TestRequest.For(Guid.NewGuid(), moderator: true, body: new MigrateTheSessionRequest(AfterTuneId: 0, BatchSize: 10));

        var result = await handler.MigrateTheSessionTunes(req);

        var ok = Assert.IsType<OkObjectResult>(result);
        var dto = Assert.IsType<MigrateTheSessionBatchResult>(ok.Value);
        Assert.Equal(1, dto.TunesCreated);
        Assert.Equal(1, dto.SettingsCreated);
        Assert.False(dto.HasMore);
    }
}
