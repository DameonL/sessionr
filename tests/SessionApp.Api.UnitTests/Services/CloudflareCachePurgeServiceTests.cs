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
}
