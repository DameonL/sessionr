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
        var handler = new MockHttpMessageHandler();
        var client = new HttpClient(handler);
        var service = new CloudflareCachePurgeService(client, NullLogger<CloudflareCachePurgeService>.Instance);

        await service.PurgeUrlsAsync(new[] { "/api/tunes" });

        Assert.Empty(handler.SentRequests);
    }

    [Fact]
    public async Task PurgeUrlsAsync_WithTokenAndZoneId_SendsCorrectPayloadToCloudflare()
    {
        const string fakeToken = "test_cloudflare_token_123";
        const string fakeZoneId = "11112222333344445555666677778888";
        Environment.SetEnvironmentVariable("CloudflareCacheToken", fakeToken);
        Environment.SetEnvironmentVariable("CloudflareZoneId", fakeZoneId);
        Environment.SetEnvironmentVariable("PublicApiBaseUrl", "https://public-api.sessionr.org");

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
        var files = doc.RootElement.GetProperty("files").EnumerateArray().Select(e => e.GetString()).ToList();

        Assert.Contains("https://public-api.sessionr.org/api/tunes", files);
        Assert.Contains("https://public-api.sessionr.org/api/tunes/guid-123", files);
    }

    [Fact]
    public async Task PurgeUrlsAsync_HttpFailure_FailsGracefullyWithoutThrowing()
    {
        Environment.SetEnvironmentVariable("CloudflareCacheToken", "fake_token");
        Environment.SetEnvironmentVariable("CloudflareZoneId", "11112222333344445555666677778888");

        var handler = new MockHttpMessageHandler
        {
            ResponseToReturn = new HttpResponseMessage(HttpStatusCode.InternalServerError)
            {
                Content = new StringContent(@"{""success"": false}")
            }
        };
        var client = new HttpClient(handler);
        var service = new CloudflareCachePurgeService(client, NullLogger<CloudflareCachePurgeService>.Instance);

        var exception = await Record.ExceptionAsync(() => service.PurgeUrlsAsync(new[] { "/api/tunes" }));

        Assert.Null(exception);
    }

    [Fact]
    public async Task PurgeTuneAsync_GeneratesCorrectRelativeUrls()
    {
        const string fakeToken = "test_token";
        const string fakeZoneId = "11112222333344445555666677778888";
        Environment.SetEnvironmentVariable("CloudflareCacheToken", fakeToken);
        Environment.SetEnvironmentVariable("CloudflareZoneId", fakeZoneId);
        Environment.SetEnvironmentVariable("PublicApiBaseUrl", "https://public-api.sessionr.org");

        var tuneId = Guid.NewGuid();
        var handler = new MockHttpMessageHandler();
        var client = new HttpClient(handler);
        var service = new CloudflareCachePurgeService(client, NullLogger<CloudflareCachePurgeService>.Instance);

        await service.PurgeTuneAsync(tuneId);

        Assert.Single(handler.SentRequests);
        var json = handler.RequestBodies[0];
        using var doc = JsonDocument.Parse(json);
        var files = doc.RootElement.GetProperty("files").EnumerateArray().Select(e => e.GetString()).ToList();

        Assert.Contains("https://public-api.sessionr.org/api/tunes", files);
        Assert.Contains($"https://public-api.sessionr.org/api/tunes/{tuneId}", files);
    }
}
