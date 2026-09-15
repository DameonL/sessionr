using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using SessionApp.Api.Services;
using Xunit;

namespace SessionApp.Api.UnitTests.Services;

// The credentials come out of the environment, which is process-wide: this keeps these tests from
// running alongside the endpoint tests that set the same variables.
[Collection("CloudflareEnv")]
public class CloudflareCachePurgeServiceTests
{
    private class MockHttpMessageHandler : HttpMessageHandler
    {
        public List<HttpRequestMessage> SentRequests { get; } = new();
        public List<string> RequestBodies { get; } = new();
        public HttpResponseMessage ResponseToReturn { get; set; } = new(HttpStatusCode.OK)
        {
            Content = new StringContent(@"{""success"": true, ""result"": [{""id"": ""zone11112222333344445555666677778888""}]}")
        };

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            SentRequests.Add(request);
            if (request.Content != null)
            {
                RequestBodies.Add(await request.Content.ReadAsStringAsync(cancellationToken));
            }
            else
            {
                RequestBodies.Add(string.Empty);
            }
            return ResponseToReturn;
        }
    }

    [Fact]
    public async Task PurgeUrlsAsync_NoToken_DoesNotSendRequest()
    {
        Environment.SetEnvironmentVariable("CloudflareCacheToken", "");
        Environment.SetEnvironmentVariable("CloudflareZoneId", "11112222333344445555666677778888");
        var handler = new MockHttpMessageHandler();
        var client = new HttpClient(handler);
        var service = new CloudflareCachePurgeService(client, NullLogger<CloudflareCachePurgeService>.Instance);

        var result = await service.PurgeUrlsAsync(new[] { "/api/tunes" });

        Assert.False(result.IsSuccess);
        Assert.Contains("CloudflareCacheToken", result.ErrorResponse);
        Assert.Empty(handler.SentRequests);
    }

    [Fact]
    public async Task PurgeUrlsAsync_NoZoneId_DoesNotSendRequest()
    {
        Environment.SetEnvironmentVariable("CloudflareCacheToken", "fake_token");
        Environment.SetEnvironmentVariable("CloudflareZoneId", "");
        var handler = new MockHttpMessageHandler();
        var client = new HttpClient(handler);
        var service = new CloudflareCachePurgeService(client, NullLogger<CloudflareCachePurgeService>.Instance);

        var result = await service.PurgeUrlsAsync(new[] { "/api/tunes" });

        Assert.False(result.IsSuccess);
        Assert.Contains("CloudflareZoneId", result.ErrorResponse);
        Assert.Empty(handler.SentRequests);
    }

    [Fact]
    public async Task PurgeUrlsAsync_WithTokenAndZoneId_SendsCorrectPayloadToCloudflare()
    {
        const string fakeToken = "test_cloudflare_token_123";
        const string fakeZoneId = "11112222333344445555666677778888";
        Environment.SetEnvironmentVariable("CloudflareCacheToken", fakeToken);
        Environment.SetEnvironmentVariable("CloudflareZoneId", fakeZoneId);
        Environment.SetEnvironmentVariable("PublicApiBaseUrl", "https://api-public.sessionr.org");

        var handler = new MockHttpMessageHandler();
        var client = new HttpClient(handler);
        var service = new CloudflareCachePurgeService(client, NullLogger<CloudflareCachePurgeService>.Instance);

        await service.PurgeUrlsAsync(new[] { "/api/tunes", "/api/tunes/guid-123" });

        Assert.Single(handler.SentRequests);
        var req = handler.SentRequests[0];
        Assert.Equal(HttpMethod.Post, req.Method);
        Assert.Equal($"https://api.cloudflare.com/client/v4/zones/{fakeZoneId}/purge_cache", req.RequestUri?.ToString());
        Assert.Equal($"Bearer {fakeToken}", req.Headers.Authorization?.ToString());

        var json = handler.RequestBodies[0];
        using var doc = JsonDocument.Parse(json);
        var prefixes = doc.RootElement.GetProperty("prefixes").EnumerateArray().Select(e => e.GetString()).ToList();

        Assert.Contains("api-public.sessionr.org/api/tunes", prefixes);
        Assert.Contains("api-public.sessionr.org/api/tunes/guid-123", prefixes);
    }

    [Fact]
    public async Task PurgeUrlsAsync_DefaultBaseUrl_PurgesApiPublicDomain()
    {
        const string fakeToken = "test_cloudflare_token_123";
        const string fakeZoneId = "11112222333344445555666677778888";
        Environment.SetEnvironmentVariable("CloudflareCacheToken", fakeToken);
        Environment.SetEnvironmentVariable("CloudflareZoneId", fakeZoneId);
        Environment.SetEnvironmentVariable("PublicApiBaseUrl", "");

        var handler = new MockHttpMessageHandler();
        var client = new HttpClient(handler);
        var service = new CloudflareCachePurgeService(client, NullLogger<CloudflareCachePurgeService>.Instance);

        await service.PurgeUrlsAsync(new[] { "/api/tunes/01a03a29-6add-740c-b62f-aa700533589d" });

        Assert.Single(handler.SentRequests);
        var json = handler.RequestBodies[0];
        using var doc = JsonDocument.Parse(json);
        var prefixes = doc.RootElement.GetProperty("prefixes").EnumerateArray().Select(e => e.GetString()).ToList();

        Assert.Single(prefixes);
        Assert.Equal("api-public.sessionr.org/api/tunes/01a03a29-6add-740c-b62f-aa700533589d", prefixes[0]);
    }

    [Fact]
    public async Task PurgeUrlsAsync_HttpFailure_ReturnsErrorResultWithBody()
    {
        Environment.SetEnvironmentVariable("CloudflareCacheToken", "fake_token");
        Environment.SetEnvironmentVariable("CloudflareZoneId", "11112222333344445555666677778888");

        var handler = new MockHttpMessageHandler
        {
            ResponseToReturn = new HttpResponseMessage(HttpStatusCode.Forbidden)
            {
                Content = new StringContent(@"{""success"": false, ""errors"": [{""code"": 10000, ""message"": ""Authentication error""}]}")
            }
        };
        var client = new HttpClient(handler);
        var service = new CloudflareCachePurgeService(client, NullLogger<CloudflareCachePurgeService>.Instance);

        var result = await service.PurgeUrlsAsync(new[] { "/api/tunes" });

        Assert.False(result.IsSuccess);
        Assert.Equal(403, result.StatusCode);
        Assert.Contains("Authentication error", result.ErrorResponse);
    }

    [Fact]
    public async Task PurgeTuneAsync_OnlyPurgesSpecificTuneUrl()
    {
        const string fakeToken = "test_token";
        const string fakeZoneId = "11112222333344445555666677778888";
        Environment.SetEnvironmentVariable("CloudflareCacheToken", fakeToken);
        Environment.SetEnvironmentVariable("CloudflareZoneId", fakeZoneId);
        Environment.SetEnvironmentVariable("PublicApiBaseUrl", "https://api-public.sessionr.org");

        var tuneId = Guid.NewGuid();
        var handler = new MockHttpMessageHandler();
        var client = new HttpClient(handler);
        var service = new CloudflareCachePurgeService(client, NullLogger<CloudflareCachePurgeService>.Instance);

        await service.PurgeTuneAsync(tuneId);

        Assert.Single(handler.SentRequests);
        var json = handler.RequestBodies[0];
        using var doc = JsonDocument.Parse(json);
        var prefixes = doc.RootElement.GetProperty("prefixes").EnumerateArray().Select(e => e.GetString()).ToList();

        Assert.Single(prefixes);
        Assert.Equal($"api-public.sessionr.org/api/tunes/{tuneId}", prefixes[0]);
    }

    [Fact]
    public async Task PurgeSetAsync_PurgesTheSetsPublicUrl()
    {
        var service = ConfiguredService(out var handler);
        var setId = Guid.NewGuid();

        await service.PurgeSetAsync(setId);

        Assert.Equal(new[] { $"api-public.sessionr.org/api/sets/{setId}" }, Prefixes(handler));
    }

    [Fact]
    public async Task PurgeSetsAsync_PurgesEveryDistinctSetInOneCall()
    {
        var service = ConfiguredService(out var handler);
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();

        await service.PurgeSetsAsync(new[] { first, second, first });

        Assert.Single(handler.SentRequests);
        Assert.Equal(
            new[] { $"api-public.sessionr.org/api/sets/{first}", $"api-public.sessionr.org/api/sets/{second}" },
            Prefixes(handler));
    }

    /// <summary>
    /// The route is /api/groupsets/{id}. This asked for /api/groups/sets/{id} — a path the API has
    /// never served — so a group set's cached copy survived every purge aimed at it.
    /// </summary>
    [Fact]
    public async Task PurgeGroupSetAsync_UsesTheRouteTheApiActuallyServes()
    {
        var service = ConfiguredService(out var handler);
        var groupSetId = Guid.NewGuid();
        var groupId = Guid.NewGuid();

        await service.PurgeGroupSetAsync(groupSetId, groupId);

        var prefixes = Prefixes(handler);
        Assert.Contains($"api-public.sessionr.org/api/groupsets/{groupSetId}", prefixes);
        Assert.Contains($"api-public.sessionr.org/api/groups/{groupId}/sets", prefixes);
        Assert.DoesNotContain(prefixes, p => p!.Contains("/api/groups/sets/"));
    }

    [Fact]
    public async Task PurgeGroupSetsAsync_PurgesEverySetAndTheGroupsList()
    {
        var service = ConfiguredService(out var handler);
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        var groupId = Guid.NewGuid();

        await service.PurgeGroupSetsAsync(new[] { first, second }, groupId);

        var prefixes = Prefixes(handler);
        Assert.Contains($"api-public.sessionr.org/api/groupsets/{first}", prefixes);
        Assert.Contains($"api-public.sessionr.org/api/groupsets/{second}", prefixes);
        Assert.Contains($"api-public.sessionr.org/api/groups/{groupId}/sets", prefixes);
    }

    [Fact]
    public async Task PurgeUserProfileAsync_PurgesTheUrlTheProfileIsActuallyServedFrom()
    {
        // Regression: this purged /api/users/{username}/profile, but the route is
        // users/by-username/{username}/profile — no URL matched, so the profile document was never
        // invalidated and a rename or a moderator sanitize served stale for the full 30-day TTL.
        var service = ConfiguredService(out var handler);

        await service.PurgeUserProfileAsync("nora-reel");

        Assert.Contains("api-public.sessionr.org/api/users/by-username/nora-reel/profile", Prefixes(handler));
    }

    [Fact]
    public async Task PurgeUserProfileAsync_PurgesTheIdKeyedReadsAlongsideIt()
    {
        var service = ConfiguredService(out var handler);
        var userId = Guid.NewGuid();

        await service.PurgeUserProfileAsync("nora-reel", userId);

        var prefixes = Prefixes(handler);
        Assert.Contains($"api-public.sessionr.org/api/users/{userId}/active-tunes", prefixes);
        Assert.Contains($"api-public.sessionr.org/api/users/{userId}/gamification", prefixes);
    }

    [Fact]
    public async Task PurgeUserSetsAsync_PurgesThePublicSetListUrl()
    {
        var service = ConfiguredService(out var handler);

        await service.PurgeUserSetsAsync(new[] { "nora-reel", "nora-reel", "sean-fiddle" });

        Assert.Equal(
            new[]
            {
                "api-public.sessionr.org/api/users/by-username/nora-reel/sets",
                "api-public.sessionr.org/api/users/by-username/sean-fiddle/sets",
            },
            Prefixes(handler));
    }

    [Fact]
    public async Task PurgeGroupDetailAsync_PurgesOnlyThatGroup()
    {
        // The whole point of this method over PurgeGroupAsync: "/api/groups" is a prefix of every
        // group URL in the zone, so emitting it would invalidate every group on a single RSVP.
        var service = ConfiguredService(out var handler);
        var groupId = Guid.NewGuid();

        await service.PurgeGroupDetailAsync(groupId);

        var prefixes = Prefixes(handler);
        Assert.Equal(new[] { $"api-public.sessionr.org/api/groups/{groupId}" }, prefixes);
        Assert.DoesNotContain("api-public.sessionr.org/api/groups", prefixes);
    }

    [Fact]
    public async Task PurgeGamificationAsync_PurgesOnlyTheGamificationUrl()
    {
        var service = ConfiguredService(out var handler);
        var userId = Guid.NewGuid();

        await service.PurgeGamificationAsync(userId);

        Assert.Equal(new[] { $"api-public.sessionr.org/api/users/{userId}/gamification" }, Prefixes(handler));
    }

    private static CloudflareCachePurgeService ConfiguredService(out MockHttpMessageHandler handler)
    {
        Environment.SetEnvironmentVariable("CloudflareCacheToken", "test_token");
        Environment.SetEnvironmentVariable("CloudflareZoneId", "11112222333344445555666677778888");
        handler = new MockHttpMessageHandler();
        return new CloudflareCachePurgeService(new HttpClient(handler), NullLogger<CloudflareCachePurgeService>.Instance);
    }

    private static List<string?> Prefixes(MockHttpMessageHandler handler) =>
        handler.RequestBodies
            .SelectMany(body => JsonDocument.Parse(body).RootElement.GetProperty("prefixes").EnumerateArray())
            .Select(e => e.GetString())
            .ToList();
}
