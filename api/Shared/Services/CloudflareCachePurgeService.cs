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

public record CloudflarePurgeResult(bool IsSuccess, int? StatusCode, string? ErrorResponse);

public interface ICloudflareCachePurgeService
{
    Task<CloudflarePurgeResult> PurgeUrlsAsync(IEnumerable<string> relativeOrAbsoluteUrls, CancellationToken cancellationToken = default);
    Task<CloudflarePurgeResult> PurgeTuneAsync(Guid tuneId, CancellationToken cancellationToken = default);
    Task<CloudflarePurgeResult> PurgeAllTunesAsync(CancellationToken cancellationToken = default);
    Task<CloudflarePurgeResult> PurgeGroupAsync(Guid groupId, CancellationToken cancellationToken = default);
    Task<CloudflarePurgeResult> PurgeGroupSetAsync(Guid groupSetId, Guid? groupId = null, CancellationToken cancellationToken = default);
    Task<CloudflarePurgeResult> PurgeGroupSetsAsync(IEnumerable<Guid> groupSetIds, Guid? groupId = null, CancellationToken cancellationToken = default);
    Task<CloudflarePurgeResult> PurgeSetAsync(Guid setId, CancellationToken cancellationToken = default);
    Task<CloudflarePurgeResult> PurgeSetsAsync(IEnumerable<Guid> setIds, CancellationToken cancellationToken = default);
    Task<CloudflarePurgeResult> PurgeUserProfileAsync(string? username = null, Guid? userId = null, CancellationToken cancellationToken = default);
    Task<CloudflarePurgeResult> PurgeUserSetsAsync(IEnumerable<string> usernames, CancellationToken cancellationToken = default);
}

public class CloudflareCachePurgeService : ICloudflareCachePurgeService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<CloudflareCachePurgeService> _logger;

    private readonly string? _apiToken;
    private readonly string? _zoneId;
    private readonly List<string> _baseUrls;

    public CloudflareCachePurgeService(HttpClient httpClient, ILogger<CloudflareCachePurgeService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;

        _apiToken = Environment.GetEnvironmentVariable("CloudflareCacheToken")?.Trim();
        _zoneId = Environment.GetEnvironmentVariable("CloudflareZoneId")?.Trim();

        _baseUrls = new List<string>
        {
            "api-public.sessionr.org"
        };
    }

    public async Task<CloudflarePurgeResult> PurgeUrlsAsync(IEnumerable<string> relativeOrAbsoluteUrls, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_apiToken))
        {
            _logger.LogDebug("CloudflareCacheToken is not configured. Skipping cache purge.");
            return new CloudflarePurgeResult(false, null, "CloudflareCacheToken environment variable is not configured.");
        }

        if (string.IsNullOrEmpty(_zoneId))
        {
            _logger.LogDebug("CloudflareZoneId is not configured. Skipping cache purge.");
            return new CloudflarePurgeResult(false, null, "CloudflareZoneId environment variable is not configured.");
        }

        var urlsToPurge = relativeOrAbsoluteUrls
            .Where(u => !string.IsNullOrWhiteSpace(u))
            .SelectMany(u => BuildAbsoluteUrls(u!))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (urlsToPurge.Count == 0)
        {
            return new CloudflarePurgeResult(true, 200, null);
        }

        try
        {
            var purgeEndpoint = $"https://api.cloudflare.com/client/v4/zones/{_zoneId}/purge_cache";
            var payload = new { prefixes = urlsToPurge };
            var jsonPayload = JsonSerializer.Serialize(payload);

            using var request = new HttpRequestMessage(HttpMethod.Post, purgeEndpoint)
            {
                Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json")
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiToken);

            using var response = await _httpClient.SendAsync(request, cancellationToken);
            var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("Successfully purged {Count} URLs from Cloudflare cache.", urlsToPurge.Count);
                return new CloudflarePurgeResult(true, (int)response.StatusCode, null);
            }
            else
            {
                _logger.LogWarning("Cloudflare cache purge returned HTTP {StatusCode}: {ErrorBody}", (int)response.StatusCode, responseBody);
                return new CloudflarePurgeResult(false, (int)response.StatusCode, responseBody);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send Cloudflare cache purge request.");
            return new CloudflarePurgeResult(false, null, ex.ToString());
        }
    }

    public Task<CloudflarePurgeResult> PurgeTuneAsync(Guid tuneId, CancellationToken cancellationToken = default)
    {
        return PurgeUrlsAsync(new[]
        {
            $"/api/tunes/{tuneId}"
        }, cancellationToken);
    }

    public Task<CloudflarePurgeResult> PurgeAllTunesAsync(CancellationToken cancellationToken = default)
    {
        return PurgeUrlsAsync(new[] { "/api/tunes" }, cancellationToken);
    }

    public Task<CloudflarePurgeResult> PurgeGroupAsync(Guid groupId, CancellationToken cancellationToken = default)
    {
        return PurgeUrlsAsync(new[]
        {
            "/api/groups",
            $"/api/groups/{groupId}",
            $"/api/groups/{groupId}/sessions",
            $"/api/groups/{groupId}/sets"
        }, cancellationToken);
    }

    public Task<CloudflarePurgeResult> PurgeGroupSetAsync(Guid groupSetId, Guid? groupId = null, CancellationToken cancellationToken = default)
    {
        // The route is /api/groupsets/{id} — this asked for /api/groups/sets/{id}, a path the API has
        // never served, so the call purged nothing even where it was made.
        var urls = new List<string> { $"/api/groupsets/{groupSetId}" };
        if (groupId.HasValue)
        {
            urls.Add($"/api/groups/{groupId.Value}/sets");
            urls.Add($"/api/groups/{groupId.Value}");
        }
        return PurgeUrlsAsync(urls, cancellationToken);
    }

    public Task<CloudflarePurgeResult> PurgeGroupSetsAsync(IEnumerable<Guid> groupSetIds, Guid? groupId = null, CancellationToken cancellationToken = default)
    {
        var urls = groupSetIds.Distinct().Select(id => $"/api/groupsets/{id}").ToList();
        if (groupId.HasValue)
        {
            urls.Add($"/api/groups/{groupId.Value}/sets");
            urls.Add($"/api/groups/{groupId.Value}");
        }
        return PurgeUrlsAsync(urls, cancellationToken);
    }

    /// <summary>
    /// A set's public read, which the app uses even for the owner's own sets. It is worth purging on
    /// create as well as on edit: the caching middleware stamps its long s-maxage before the handler
    /// runs, so the 404 for a set that did not exist yet is held just as long as the set itself.
    /// </summary>
    public Task<CloudflarePurgeResult> PurgeSetAsync(Guid setId, CancellationToken cancellationToken = default)
    {
        return PurgeUrlsAsync(new[] { $"/api/sets/{setId}" }, cancellationToken);
    }

    public Task<CloudflarePurgeResult> PurgeSetsAsync(IEnumerable<Guid> setIds, CancellationToken cancellationToken = default)
    {
        return PurgeUrlsAsync(setIds.Distinct().Select(id => $"/api/sets/{id}"), cancellationToken);
    }

    public Task<CloudflarePurgeResult> PurgeUserProfileAsync(string? username = null, Guid? userId = null, CancellationToken cancellationToken = default)
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

    /// <summary>
    /// The public per-user set lists shown on a profile. A set being created, renamed, re-ordered or
    /// deleted changes the list as well as the set, and the list is cached just as long.
    /// </summary>
    public Task<CloudflarePurgeResult> PurgeUserSetsAsync(IEnumerable<string> usernames, CancellationToken cancellationToken = default)
    {
        var urls = usernames
            .Where(u => !string.IsNullOrWhiteSpace(u))
            .Distinct()
            .Select(u => $"/api/users/by-username/{u}/sets");
        return PurgeUrlsAsync(urls, cancellationToken);
    }

    private IEnumerable<string> BuildAbsoluteUrls(string url)
    {
        if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            yield return StripScheme(url);
            yield break;
        }

        var path = url.StartsWith('/') ? url : $"/{url}";
        foreach (var baseUrl in _baseUrls)
        {
            yield return $"{baseUrl}{path}";
        }
    }

    private static string StripScheme(string url)
    {
        if (url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return url.Substring("https://".Length);
        }
        if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
        {
            return url.Substring("http://".Length);
        }
        return url;
    }
}
