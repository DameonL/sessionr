using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

namespace SessionApp.Api.UnitTests.Functions;

/// <summary>
/// Serializes the tests that read the Cloudflare credentials out of the environment, which is
/// process-wide state two classes would otherwise race each other over.
/// </summary>
[CollectionDefinition("CloudflareEnv", DisableParallelization = true)]
public class CloudflareEnvCollection;

/// <summary>
/// A real <see cref="CloudflareCachePurgeService"/> with its HTTP call intercepted, so a test can
/// assert the URLs the production code actually asks Cloudflare to purge rather than a fake's idea
/// of them.
/// </summary>
public sealed class PurgeRecorder : HttpMessageHandler
{
    private readonly List<string> _bodies = new();

    public static PurgeRecorder Create(out ICloudflareCachePurgeService service)
    {
        Environment.SetEnvironmentVariable("CloudflareCacheToken", "test_token");
        Environment.SetEnvironmentVariable("CloudflareZoneId", "11112222333344445555666677778888");
        var recorder = new PurgeRecorder();
        service = new CloudflareCachePurgeService(new HttpClient(recorder), NullLogger<CloudflareCachePurgeService>.Instance);
        return recorder;
    }

    /// <summary>Every prefix purged so far, with the host stripped back to the API path.</summary>
    public IReadOnlyList<string> PurgedPaths => _bodies
        .SelectMany(body => JsonDocument.Parse(body).RootElement.GetProperty("prefixes").EnumerateArray())
        .Select(p => p.GetString() ?? string.Empty)
        .Select(url => url.Substring(url.IndexOf("/api", StringComparison.Ordinal)))
        .ToList();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.Content is not null)
        {
            _bodies.Add(await request.Content.ReadAsStringAsync(cancellationToken));
        }
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(@"{""success"": true}"),
        };
    }
}

public static class SetCacheTestDb
{
    /// <summary>A SQLite in-memory database on the real model, as the other function tests use.</summary>
    public static AppDbContext Create()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;
        var db = new AppDbContext(options);
        db.Database.EnsureCreated();
        return db;
    }
}
