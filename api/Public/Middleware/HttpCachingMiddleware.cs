using System;
using System.IO;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;

namespace SessionApp.Api.Functions;

/// <summary>
/// Middleware that enforces standard HTTP caching headers on Public API GET responses.
///
/// Without a Cache-Control header from origin, Cloudflare stamps its own Browser Cache TTL onto
/// the response, so browsers hold a copy for hours and CloudflareCachePurgeService's edge purge is
/// invisible to them. The header pair below splits the two caches apart: s-maxage drives a long
/// edge TTL (purges stay effective and cheap), while max-age=0/must-revalidate makes the browser
/// revalidate every time — normally answered by a body-less 304 from Cloudflare's cached copy.
///
/// Offline reads do not depend on this: they come from the IndexedDB layer in
/// frontend/src/services/offlineDb.ts, which api.ts populates on every successful GET.
/// </summary>
public class PublicHttpCachingMiddleware : IFunctionsWorkerMiddleware
{
    private const string PublicCacheControl = "public, max-age=0, must-revalidate, s-maxage=2592000";
    private const string PrivateCacheControl = "private, no-cache, must-revalidate";

    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        var httpContext = context.GetHttpContext();
        if (httpContext is null)
        {
            await next(context);
            return;
        }

        var request = httpContext.Request;
        var response = httpContext.Response;

        if (!HttpMethods.IsGet(request.Method))
        {
            await next(context);
            return;
        }

        // Every Public GET is anonymous today (only the moderator refresh-match-index POST carries a
        // bearer token), but a credentialed response must never land in a shared cache, so fall back
        // to the Private app's policy if one ever does.
        if (!string.IsNullOrEmpty(request.Headers.Authorization.ToString()))
        {
            response.Headers["Vary"] = "Authorization";
            response.Headers["Cache-Control"] = PrivateCacheControl;
        }
        else
        {
            response.Headers["Cache-Control"] = PublicCacheControl;
        }

        // Buffer response body stream to compute ETag
        var originalBodyStream = response.Body;
        using var memoryStream = new MemoryStream();
        response.Body = memoryStream;

        try
        {
            await next(context);

            if (response.StatusCode == StatusCodes.Status200OK && memoryStream.Length > 0)
            {
                memoryStream.Position = 0;
                var hashBytes = SHA256.HashData(memoryStream.ToArray());
                var etag = $"W/\"{Convert.ToHexString(hashBytes)[..16]}\"";
                response.Headers.ETag = etag;

                var ifNoneMatch = request.Headers.IfNoneMatch.ToString();
                if (!string.IsNullOrEmpty(ifNoneMatch) &&
                    string.Equals(NormalizeETag(ifNoneMatch), NormalizeETag(etag), StringComparison.Ordinal))
                {
                    response.StatusCode = StatusCodes.Status304NotModified;
                    response.ContentLength = 0;
                    memoryStream.SetLength(0); // Clear body for 304 response
                }
            }

            memoryStream.Position = 0;
            await memoryStream.CopyToAsync(originalBodyStream);
        }
        finally
        {
            response.Body = originalBodyStream;
        }
    }

    /// <summary>
    /// Reduces a validator to its opaque tag so a weak and a strong form of the same value compare
    /// equal — intermediaries (Cloudflare included) may re-emit the validator with or without the
    /// W/ prefix.
    /// </summary>
    private static string NormalizeETag(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.StartsWith("W/", StringComparison.Ordinal))
        {
            trimmed = trimmed.Substring(2);
        }
        return trimmed.Trim('"');
    }
}
