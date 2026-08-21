using SessionApp.Api.Functions;
using SessionApp.Api.TestSupport;

namespace SessionApp.Api.UnitTests;

/// <summary>
/// Covers only the parts of <see cref="AzureDirectoryAuthorization"/> that read the request — no
/// database. The DB-backed half (EnsureUserExistsAsync / GetCallerUserIdAsync) is exercised against
/// a real Cosmos in the integration suite.
/// </summary>
public class AzureDirectoryAuthorizationTests
{
    private static readonly Guid Oid = Guid.Parse("11111111-2222-3333-4444-555555555555");

    // --- Bearer token ---

    [Fact]
    public void GetCallerIdentity_ReadsOidEmailAndNameFromABearerToken()
    {
        var request = TestRequest.For(Oid, "Player@Example.COM", "Dev Musician");

        var identity = request.GetCallerIdentity();

        Assert.Equal(Oid, identity.UserId);
        Assert.Equal("Player@Example.COM", identity.Email); // normalization happens at the DB layer, not here
        Assert.Equal("Dev Musician", identity.DisplayName);
    }

    [Fact]
    public void GetCallerIdentity_FallsBackToSubWhenThereIsNoOid()
    {
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object>
        {
            ["sub"] = Oid.ToString(),
            ["exp"] = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds(),
        });

        var identity = TestRequest.WithAuthorizationHeader($"Bearer {token}").GetCallerIdentity();

        Assert.Equal(Oid, identity.UserId);
    }

    [Fact]
    public void GetCallerIdentity_FallsBackToPreferredUsernameWhenThereIsNoEmail()
    {
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object>
        {
            ["oid"] = Oid.ToString(),
            ["preferred_username"] = "player@example.com",
            ["exp"] = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds(),
        });

        var identity = TestRequest.WithAuthorizationHeader($"Bearer {token}").GetCallerIdentity();

        Assert.Equal("player@example.com", identity.Email);
    }

    [Fact]
    public void GetCallerIdentity_AcceptsAnEmailOnlyTokenWithNoUsableOid()
    {
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object>
        {
            ["sub"] = "not-a-guid",
            ["email"] = "player@example.com",
            ["exp"] = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds(),
        });

        var identity = TestRequest.WithAuthorizationHeader($"Bearer {token}").GetCallerIdentity();

        Assert.Null(identity.UserId);
        Assert.Equal("player@example.com", identity.Email);
    }

    [Fact]
    public void GetCallerIdentity_RejectsAnExpiredToken()
    {
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object>
        {
            ["oid"] = Oid.ToString(),
            ["email"] = "player@example.com",
            ["exp"] = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeSeconds(),
        });

        var identity = TestRequest.WithAuthorizationHeader($"Bearer {token}").GetCallerIdentity();

        Assert.Null(identity.UserId);
        Assert.Null(identity.Email);
        Assert.Null(identity.DisplayName);
    }

    [Fact]
    public void GetCallerIdentity_AcceptsAStringEncodedExpiry()
    {
        // Some issuers serialize exp as a string rather than a number.
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object>
        {
            ["oid"] = Oid.ToString(),
            ["exp"] = DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeSeconds().ToString(),
        });

        Assert.Null(TestRequest.WithAuthorizationHeader($"Bearer {token}").GetCallerIdentity().UserId);
    }

    [Fact]
    public void GetCallerIdentity_ATokenWithoutAnExpiryIsStillAccepted()
    {
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object> { ["oid"] = Oid.ToString() });

        Assert.Equal(Oid, TestRequest.WithAuthorizationHeader($"Bearer {token}").GetCallerIdentity().UserId);
    }

    [Fact]
    public void GetCallerIdentity_TheBearerPrefixIsCaseInsensitive()
    {
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object> { ["oid"] = Oid.ToString() });

        Assert.Equal(Oid, TestRequest.WithAuthorizationHeader($"bearer {token}").GetCallerIdentity().UserId);
    }

    [Theory]
    [InlineData("")]
    [InlineData("Bearer")]
    [InlineData("Bearer ")]
    [InlineData("Bearer notajwt")]
    [InlineData("Bearer one.two")]              // too few segments
    [InlineData("Bearer a.b.c.d")]              // too many segments
    [InlineData("Bearer aaa.!!!not-base64!!!.c")]
    [InlineData("Bearer aaa.eyJub3QiOiJqc29u.c")] // truncated / invalid JSON payload
    [InlineData("Basic dXNlcjpwYXNz")]          // wrong scheme entirely
    public void GetCallerIdentity_MalformedAuthorizationHeadersYieldNoIdentity(string headerValue)
    {
        var identity = TestRequest.WithAuthorizationHeader(headerValue).GetCallerIdentity();

        Assert.Null(identity.UserId);
        Assert.Null(identity.Email);
    }

    [Fact]
    public void GetCallerIdentity_NoHeadersAtAllYieldsNoIdentity()
    {
        var identity = TestRequest.Anonymous().GetCallerIdentity();

        Assert.Null(identity.UserId);
        Assert.Null(identity.Email);
        Assert.Null(identity.DisplayName);
    }

    // --- EasyAuth client principal ---

    [Fact]
    public void GetCallerIdentity_ReadsTheEasyAuthClientPrincipalHeader()
    {
        var request = TestRequest.WithClientPrincipal(
            ("http://schemas.microsoft.com/identity/claims/objectidentifier", Oid.ToString()),
            ("http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", "player@example.com"),
            ("name", "Dev Musician"));

        var identity = request.GetCallerIdentity();

        Assert.Equal(Oid, identity.UserId);
        Assert.Equal("player@example.com", identity.Email);
        Assert.Equal("Dev Musician", identity.DisplayName);
    }

    [Theory]
    [InlineData("oid")]
    [InlineData("sub")]
    [InlineData("http://schemas.microsoft.com/identity/claims/objectidentifier")]
    public void GetCallerIdentity_AcceptsEitherSpellingOfTheObjectIdClaim(string claimType)
    {
        var identity = TestRequest.WithClientPrincipal((claimType, Oid.ToString())).GetCallerIdentity();

        Assert.Equal(Oid, identity.UserId);
    }

    [Fact]
    public void GetCallerIdentity_ClientPrincipalWithOnlyAnEmailStillIdentifiesTheCaller()
    {
        var identity = TestRequest.WithClientPrincipal(("email", "player@example.com")).GetCallerIdentity();

        Assert.Null(identity.UserId);
        Assert.Equal("player@example.com", identity.Email);
    }

    [Fact]
    public void GetCallerIdentity_MalformedClientPrincipalHeaderYieldsNoIdentity()
    {
        var request = TestRequest.Anonymous();
        request.Headers["X-MS-CLIENT-PRINCIPAL"] = "not-base64!!";

        Assert.Null(request.GetCallerIdentity().UserId);
    }

    [Fact]
    public void GetCallerIdentity_ReadsTheDirectPrincipalIdHeader()
    {
        var request = TestRequest.Anonymous();
        request.Headers["X-MS-CLIENT-PRINCIPAL-ID"] = Oid.ToString();

        Assert.Equal(Oid, request.GetCallerIdentity().UserId);
    }

    [Fact]
    public void GetCallerIdentity_ANonGuidPrincipalIdHeaderYieldsNoIdentity()
    {
        var request = TestRequest.Anonymous();
        request.Headers["X-MS-CLIENT-PRINCIPAL-ID"] = "definitely-not-a-guid";

        Assert.Null(request.GetCallerIdentity().UserId);
    }

    [Fact]
    public void GetCallerIdentity_TheBearerTokenWinsOverEasyAuthHeaders()
    {
        var other = Guid.Parse("99999999-9999-9999-9999-999999999999");
        var request = TestRequest.For(Oid);
        request.Headers["X-MS-CLIENT-PRINCIPAL-ID"] = other.ToString();

        Assert.Equal(Oid, request.GetCallerIdentity().UserId);
    }

    // --- Group claims ---

    [Fact]
    public void IsCallerModerator_TrueForATokenCarryingTheModeratorGroup()
    {
        Assert.True(TestRequest.For(Oid, moderator: true).IsCallerModerator());
    }

    [Fact]
    public void IsCallerModerator_FalseForAnOrdinaryToken()
    {
        Assert.False(TestRequest.For(Oid).IsCallerModerator());
    }

    [Fact]
    public void IsCallerModerator_FalseForAnAnonymousRequest()
    {
        Assert.False(TestRequest.Anonymous().IsCallerModerator());
    }

    [Fact]
    public void IsCallerModerator_FalseWhenTheGroupClaimIsSomeOtherGroup()
    {
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object>
        {
            ["oid"] = Oid.ToString(),
            ["groups"] = new[] { Guid.NewGuid().ToString() },
        });

        Assert.False(TestRequest.WithAuthorizationHeader($"Bearer {token}").IsCallerModerator());
    }

    [Theory]
    [InlineData("groups")]
    [InlineData("wids")]
    [InlineData("roles")]
    [InlineData("http://schemas.microsoft.com/ws/2008/06/identity/claims/groups")]
    public void HasEntraGroupClaim_AcceptsEveryRecognizedGroupClaimKey(string claimKey)
    {
        var target = Guid.NewGuid().ToString();
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object>
        {
            ["oid"] = Oid.ToString(),
            [claimKey] = new[] { target },
        });

        Assert.True(TestRequest.WithAuthorizationHeader($"Bearer {token}").HasEntraGroupClaim(target));
    }

    [Fact]
    public void HasEntraGroupClaim_AcceptsASingleStringClaimAsWellAsAnArray()
    {
        var target = Guid.NewGuid().ToString();
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object>
        {
            ["oid"] = Oid.ToString(),
            ["groups"] = target, // not wrapped in an array
        });

        Assert.True(TestRequest.WithAuthorizationHeader($"Bearer {token}").HasEntraGroupClaim(target));
    }

    [Fact]
    public void HasEntraGroupClaim_MatchesCaseInsensitively()
    {
        var target = Guid.NewGuid().ToString();
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object>
        {
            ["oid"] = Oid.ToString(),
            ["groups"] = new[] { target.ToUpperInvariant() },
        });

        Assert.True(TestRequest.WithAuthorizationHeader($"Bearer {token}").HasEntraGroupClaim(target.ToLowerInvariant()));
    }

    [Fact]
    public void HasEntraGroupClaim_ReadsGroupsFromTheEasyAuthClientPrincipalToo()
    {
        var target = Guid.NewGuid().ToString();
        var request = TestRequest.WithClientPrincipal(("groups", target));

        Assert.True(request.HasEntraGroupClaim(target));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void HasEntraGroupClaim_ABlankTargetNeverMatches(string target)
    {
        Assert.False(TestRequest.For(Oid, moderator: true).HasEntraGroupClaim(target));
    }

    // --- Timezone offset ---

    [Fact]
    public void GetTimezoneOffsetMinutes_ReadsTheHeader()
    {
        Assert.Equal(300, TestRequest.Anonymous(timezoneOffsetMinutes: 300).GetTimezoneOffsetMinutes());
        Assert.Equal(-60, TestRequest.Anonymous(timezoneOffsetMinutes: -60).GetTimezoneOffsetMinutes());
    }

    [Fact]
    public void GetTimezoneOffsetMinutes_DefaultsToUtcWhenTheHeaderIsMissing()
    {
        Assert.Equal(0, TestRequest.Anonymous().GetTimezoneOffsetMinutes());
    }

    [Fact]
    public void GetTimezoneOffsetMinutes_DefaultsToUtcWhenTheHeaderIsNotANumber()
    {
        var request = TestRequest.Anonymous();
        request.Headers["X-Timezone-Offset"] = "half past three";

        Assert.Equal(0, request.GetTimezoneOffsetMinutes());
    }
}
