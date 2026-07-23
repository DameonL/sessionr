using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;

namespace SessionApp.Api.Functions;

/// <summary>
/// Middleware that enforces standard HTTP caching headers on Private API GET responses.
/// Injects Vary: Authorization and Cache-Control: private, no-cache, must-revalidate.
/// Generates ETags for 200 OK GET responses and handles If-None-Match with 304 Not Modified short-circuiting.
/// </summary>
public class HttpCachingMiddleware : IFunctionsWorkerMiddleware
{
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
        var isGet = HttpMethods.IsGet(request.Method);

        if (!isGet)
        {
            await next(context);
            return;
        }

        // Add standard HTTP headers for private API GETs
        response.Headers["Vary"] = "Authorization";
        response.Headers["Cache-Control"] = "private, no-cache, must-revalidate";

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
                var etag = $"\"W/{Convert.ToHexString(hashBytes)[..16]}\"";
                response.Headers.ETag = etag;

                var ifNoneMatch = request.Headers.IfNoneMatch.ToString();
                if (!string.IsNullOrEmpty(ifNoneMatch) && string.Equals(ifNoneMatch.Trim('"'), etag.Trim('"'), StringComparison.Ordinal))
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
}
