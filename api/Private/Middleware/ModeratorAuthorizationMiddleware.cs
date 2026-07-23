using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;

namespace SessionApp.Api.Functions;

/// <summary>
/// Middleware that automatically intercepts requests targeting moderator routes (/api/moderator/*)
/// or functions decorated with [RequireModerator], verifying Azure Entra ID Moderator group claims
/// before invoking downstream function execution.
/// </summary>
public class ModeratorAuthorizationMiddleware : IFunctionsWorkerMiddleware
{
    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        var httpContext = context.GetHttpContext();

        if (httpContext is not null)
        {
            var path = httpContext.Request.Path.Value ?? string.Empty;
            var isModeratorPath = path.StartsWith("/api/moderator", StringComparison.OrdinalIgnoreCase) ||
                                  path.StartsWith("/moderator", StringComparison.OrdinalIgnoreCase);

            var endpoint = httpContext.GetEndpoint();
            var hasAttribute = endpoint?.Metadata.GetMetadata<RequireModeratorAttribute>() is not null;

            if (isModeratorPath || hasAttribute)
            {
                if (!httpContext.Request.IsCallerModerator())
                {
                    httpContext.Response.StatusCode = StatusCodes.Status403Forbidden;
                    httpContext.Response.ContentType = "text/plain";
                    await httpContext.Response.WriteAsync("Forbidden: Azure Moderator directory group privileges required.");
                    return; // Short-circuit execution pipeline
                }
            }
        }

        await next(context);
    }
}
