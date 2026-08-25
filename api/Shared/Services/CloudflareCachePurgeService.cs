using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace SessionApp.Api.Services;

public interface ICloudflareCachePurgeService
{
    Task PurgeUrlsAsync(IEnumerable<string> relativeOrAbsoluteUrls, CancellationToken cancellationToken = default);
    Task PurgeTuneAsync(Guid tuneId, CancellationToken cancellationToken = default);
    Task PurgeAllTunesAsync(CancellationToken cancellationToken = default);
    Task PurgeGroupAsync(Guid groupId, CancellationToken cancellationToken = default);
    Task PurgeGroupSetAsync(Guid groupSetId, Guid? groupId = null, CancellationToken cancellationToken = default);
    Task PurgeUserProfileAsync(string? username = null, Guid? userId = null, CancellationToken cancellationToken = default);
}

public class CloudflareCachePurgeService : ICloudflareCachePurgeService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<CloudflareCachePurgeService> _logger;

    private readonly string? _apiToken;
    private readonly string _zoneConfig;
    private readonly List<string> _baseUrls;

    private string? _resolvedZoneId;
    private bool _zoneResolutionAttempted;

    public CloudflareCachePurgeService(HttpClient httpClient, ILogger<CloudflareCachePurgeService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;

        _apiToken = Environment.GetEnvironmentVariable("CloudflareCacheToken")?.Trim();

        _zoneConfig = Environment.GetEnvironmentVariable("CloudflareZoneId")?.Trim()
            ?? Environment.GetEnvironmentVariable("CLOUDFLARE_ZONE_ID")?.Trim()
            ?? Environment.GetEnvironmentVariable("CloudflareZone")?.Trim()
            ?? "sessionr.org";

        var rawBaseUrlConfig = Environment.GetEnvironmentVariable("PublicApiBaseUrl")?.Trim()
            ?? Environment.GetEnvironmentVariable("PUBLIC_API_BASE_URL")?.Trim();

        if (!string.IsNullOrWhiteSpace(rawBaseUrlConfig))
        {
            _baseUrls = rawBaseUrlConfig
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(b => b.TrimEnd('/'))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        else
        {
            _baseUrls = new List<string>
            {
                "https://api-public.sessionr.org"
            };
        }
    }

    public async Task PurgeUrlsAsync(IEnumerable<string> relativeOrAbsoluteUrls, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_apiToken))
        {
            _logger.LogDebug("CloudflareCacheToken is not configured. Skipping cache purge.");
            return;
        }

        var urlsToPurge = relativeOrAbsoluteUrls
            .Where(u => !string.IsNullOrWhiteSpace(u))
            .SelectMany(u => BuildAbsoluteUrls(u!))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (urlsToPurge.Count == 0)
        {
            return;
        }

        var zoneId = await GetZoneIdAsync(cancellationToken);
        if (string.IsNullOrEmpty(zoneId))
        {
            _logger.LogWarning("Could not resolve Cloudflare Zone ID for {ZoneConfig}. Skipping cache purge.", _zoneConfig);
            return;
        }

        try
        {
            var purgeEndpoint = $"https://api.cloudflare.com/client/v4/zones/{zoneId}/purge_cache";
            var payload = new { files = urlsToPurge };
            var jsonPayload = JsonSerializer.Serialize(payload);

            using var request = new HttpRequestMessage(HttpMethod.Post, purgeEndpoint)
            {
                Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json")
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiToken);

            using var response = await _httpClient.SendAsync(request, cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("Successfully purged {Count} URLs from Cloudflare cache.", urlsToPurge.Count);
            }
            else
            {
                var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogWarning("Cloudflare cache purge returned HTTP {StatusCode}: {ErrorBody}", (int)response.StatusCode, errorBody);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send Cloudflare cache purge request.");
        }
    }

    public Task PurgeTuneAsync(Guid tuneId, CancellationToken cancellationToken = default)
    {
        return PurgeUrlsAsync(new[]
        {
            $"/api/tunes/{tuneId}"
        }, cancellationToken);
    }

    public Task PurgeAllTunesAsync(CancellationToken cancellationToken = default)
    {
        return PurgeUrlsAsync(new[] { "/api/tunes" }, cancellationToken);
    }

    public Task PurgeGroupAsync(Guid groupId, CancellationToken cancellationToken = default)
    {
        return PurgeUrlsAsync(new[]
        {
            "/api/groups",
            $"/api/groups/{groupId}",
            $"/api/groups/{groupId}/sessions",
            $"/api/groups/{groupId}/sets"
        }, cancellationToken);
    }

    public Task PurgeGroupSetAsync(Guid groupSetId, Guid? groupId = null, CancellationToken cancellationToken = default)
    {
        var urls = new List<string> { $"/api/groups/sets/{groupSetId}" };
        if (groupId.HasValue)
        {
            urls.Add($"/api/groups/{groupId.Value}/sets");
            urls.Add($"/api/groups/{groupId.Value}");
        }
        return PurgeUrlsAsync(urls, cancellationToken);
    }

    public Task PurgeUserProfileAsync(string? username = null, Guid? userId = null, CancellationToken cancellationToken = default)
    {
        var urls = new List<string>();
        if (!string.IsNullOrWhiteSpace(username))
        {
            urls.Add($"/api/users/{username}/profile");
            urls.Add($"/api/users/username-available/{username}");
        }
        if (userId.HasValue)
        {
            urls.Add($"/api/users/{userId.Value}/active-tunes");
            urls.Add($"/api/users/{userId.Value}/gamification");
        }
        return PurgeUrlsAsync(urls, cancellationToken);
    }

    private IEnumerable<string> BuildAbsoluteUrls(string url)
    {
        if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            yield return url;
            yield break;
        }

        var path = url.StartsWith('/') ? url : $"/{url}";
        foreach (var baseUrl in _baseUrls)
        {
            yield return $"{baseUrl}{path}";
        }
    }

    private async Task<string?> GetZoneIdAsync(CancellationToken cancellationToken)
    {
        if (_resolvedZoneId != null)
        {
            return _resolvedZoneId;
        }

        if (IsZoneId(_zoneConfig))
        {
            _resolvedZoneId = _zoneConfig;
            return _resolvedZoneId;
        }

        if (_zoneResolutionAttempted)
        {
            return null;
        }

        _zoneResolutionAttempted = true;
        try
        {
            var lookupEndpoint = $"https://api.cloudflare.com/client/v4/zones?name={Uri.EscapeDataString(_zoneConfig)}";
            using var request = new HttpRequestMessage(HttpMethod.Get, lookupEndpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiToken);

            using var response = await _httpClient.SendAsync(request, cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync(cancellationToken);
                using var doc = JsonDocument.Parse(content);
                var root = doc.RootElement;
                if (root.TryGetProperty("result", out var resultArr) && resultArr.ValueKind == JsonValueKind.Array && resultArr.GetArrayLength() > 0)
                {
                    var firstZone = resultArr[0];
                    if (firstZone.TryGetProperty("id", out var idProp))
                    {
                        _resolvedZoneId = idProp.GetString();
                        return _resolvedZoneId;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to resolve Cloudflare Zone ID for zone name {ZoneName}", _zoneConfig);
        }

        return null;
    }

    private static bool IsZoneId(string zone)
    {
        return zone.Length == 32 && zone.All(c => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));
    }
}
