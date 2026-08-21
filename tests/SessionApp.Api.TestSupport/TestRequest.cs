using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;

namespace SessionApp.Api.TestSupport;

/// <summary>
/// Builds the <see cref="HttpRequest"/> objects the Function classes take, carrying the same
/// caller-identity headers Azure puts on a real request.
///
/// The bearer tokens produced here are deliberately <em>unsigned</em>: the API reads the caller's
/// oid/email straight out of the JWT payload and never validates the signature, issuer, audience or
/// scope (see <c>AzureDirectoryAuthorization.GetCallerIdentity</c>). Signing them would test nothing
/// the production code looks at.
/// </summary>
public static class TestRequest
{
    /// <summary>The Entra directory group the moderator-only endpoints check for.</summary>
    public const string ModeratorGroupId = "83bbddaa-d861-4904-a932-371f5d33dfe8";

    /// <summary>A request authenticated as <paramref name="userId"/> via a Bearer token.</summary>
    public static HttpRequest For(
        Guid userId,
        string? email = null,
        string? displayName = null,
        object? body = null,
        IDictionary<string, string>? query = null,
        bool moderator = false,
        int? timezoneOffsetMinutes = null)
    {
        var claims = new Dictionary<string, object>
        {
            ["oid"] = userId.ToString(),
            ["exp"] = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds(),
        };
        if (email is not null) claims["email"] = email;
        if (displayName is not null) claims["name"] = displayName;
        if (moderator) claims["groups"] = new[] { ModeratorGroupId };

        var request = Anonymous(body, query, timezoneOffsetMinutes);
        request.Headers["Authorization"] = $"Bearer {UnsignedJwt(claims)}";
        return request;
    }

    /// <summary>A request with no caller identity at all — what an unauthenticated call looks like.</summary>
    public static HttpRequest Anonymous(
        object? body = null,
        IDictionary<string, string>? query = null,
        int? timezoneOffsetMinutes = null)
    {
        var context = new DefaultHttpContext();
        var request = context.Request;

        if (query is { Count: > 0 })
        {
            request.QueryString = QueryString.Create(query.Select(kv => KeyValuePair.Create(kv.Key, (Microsoft.Extensions.Primitives.StringValues)kv.Value)));
        }

        if (body is not null)
        {
            var json = body as string ?? JsonSerializer.Serialize(body);
            request.Body = new MemoryStream(Encoding.UTF8.GetBytes(json));
            request.ContentType = "application/json";
            request.ContentLength = request.Body.Length;
        }

        if (timezoneOffsetMinutes is int offset)
        {
            request.Headers["X-Timezone-Offset"] = offset.ToString();
        }

        return request;
    }

    /// <summary>A request carrying a raw Authorization header value, for malformed-token cases.</summary>
    public static HttpRequest WithAuthorizationHeader(string headerValue)
    {
        var request = Anonymous();
        request.Headers["Authorization"] = headerValue;
        return request;
    }

    /// <summary>A request authenticated the EasyAuth way, via the base64 client-principal header.</summary>
    public static HttpRequest WithClientPrincipal(params (string Type, string Value)[] claims)
    {
        var principal = new { claims = claims.Select(c => new { typ = c.Type, val = c.Value }).ToArray() };
        var request = Anonymous();
        request.Headers["X-MS-CLIENT-PRINCIPAL"] =
            Convert.ToBase64String(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(principal)));
        return request;
    }

    /// <summary>Encodes claims as an unsigned JWT: <c>base64url(header).base64url(payload).notasignature</c>.</summary>
    public static string UnsignedJwt(IDictionary<string, object> claims)
    {
        var header = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { alg = "none", typ = "JWT" }));
        var payload = Base64Url(JsonSerializer.SerializeToUtf8Bytes(claims));
        return $"{header}.{payload}.notasignature";
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
