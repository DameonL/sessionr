using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Functions;
using SessionApp.Api.IntegrationTests.Infrastructure;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using SessionApp.Api.TestSupport;

namespace SessionApp.Api.IntegrationTests.Auth;

/// <summary>
/// Every authenticated endpoint funnels through <c>GetCallerUserIdAsync</c>, so this is the most
/// heavily executed database code in the app — and on Cosmos it runs without the unique indexes on
/// Email and Username that the relational model declares. Uniqueness here is upheld entirely by
/// these code paths.
///
/// Note the process-wide static <c>MemoryCache</c> inside <c>AzureDirectoryAuthorization</c>: every
/// test below uses a fresh oid and a fresh email so it cannot be answered from another test's
/// cached entry.
/// </summary>
public class EnsureUserExistsTests(CosmosEmulatorFixture fixture) : CosmosTestBase(fixture)
{
    private Task<List<User>> UsersWithOidAsync(Guid userId) =>
        Fixture.WithDbAsync(db => db.Users.AsNoTracking().Where(u => u.UserId == userId).ToListAsync());

    private Task<User?> UserAsync(Guid userId) =>
        Fixture.WithDbAsync(db => db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.UserId == userId));

    [Fact]
    public async Task CreatesAUserOnFirstSight()
    {
        var oid = TestData.NewId();
        var email = TestData.NewEmail();

        var userId = await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, email, "Dev Musician"));

        Assert.Equal(oid, userId);
        var created = await UserAsync(oid);
        Assert.NotNull(created);
        Assert.Equal("Dev Musician", created!.DisplayName);
        Assert.Equal(email.ToLowerInvariant(), created.Email);
    }

    [Fact]
    public async Task NormalizesTheEmailToLowercase()
    {
        var oid = TestData.NewId();
        var email = TestData.NewEmail().ToUpperInvariant();

        await Fixture.WithDbAsync(db => AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, email, "Shouty"));

        Assert.Equal(email.ToLowerInvariant(), (await UserAsync(oid))!.Email);
    }

    [Fact]
    public async Task ClaimsAUsernameSlugDerivedFromTheDisplayName()
    {
        var oid = TestData.NewId();
        var displayName = $"Fiddler {Guid.CreateVersion7():N}"[..24];

        await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, TestData.NewEmail(), displayName));

        Assert.Equal(UsernameSlug.Slugify(displayName), (await UserAsync(oid))!.Username);
    }

    [Fact]
    public async Task LeavesTheUsernameNullWhenTheSlugIsAlreadyTaken()
    {
        // Deliberately no auto-suffixing: the frontend gates app entry on a null username and
        // routes the user to pick one explicitly.
        var displayName = $"Piper {Guid.CreateVersion7():N}"[..22];
        var slug = UsernameSlug.Slugify(displayName)!;
        await SeedAsync(db => db.SeedUserAsync(username: slug));

        var oid = TestData.NewId();
        await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, TestData.NewEmail(), displayName));

        Assert.Null((await UserAsync(oid))!.Username);
    }

    [Fact]
    public async Task LeavesTheUsernameNullWhenTheDisplayNameYieldsNoSlug()
    {
        var oid = TestData.NewId();

        await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, TestData.NewEmail(), "!!"));

        Assert.Null((await UserAsync(oid))!.Username);
    }

    [Fact]
    public async Task FallsBackToAPlaceholderDisplayNameAndEmail()
    {
        var oid = TestData.NewId();

        await Fixture.WithDbAsync(db => AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid));

        var created = await UserAsync(oid);
        Assert.Equal("Musician", created!.DisplayName);
        Assert.Equal($"{oid:N}@auth.sessionr", created.Email);
    }

    [Fact]
    public async Task IsIdempotentForTheSameOid()
    {
        // Without a unique index on Cosmos, a second call creating a second document would go
        // undetected until a SingleAsync somewhere blew up.
        var oid = TestData.NewId();
        var email = TestData.NewEmail();

        await Fixture.WithDbAsync(db => AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, email, "Repeat"));
        var second = await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, email, "Repeat"));

        Assert.Equal(oid, second);
        Assert.Single(await UsersWithOidAsync(oid));
    }

    [Fact]
    public async Task RefreshesAChangedEmailOnAKnownUser()
    {
        var oid = TestData.NewId();
        await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, TestData.NewEmail(), "Mover"));

        var newEmail = TestData.NewEmail("moved");
        await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, newEmail, "Mover"));

        Assert.Equal(newEmail, (await UserAsync(oid))!.Email);
        Assert.Single(await UsersWithOidAsync(oid));
    }

    [Fact]
    public async Task MatchesAnExistingUserByEmailWhenTheOidIsUnknown()
    {
        // The legacy path: a user created before oids were recorded still resolves by email
        // rather than being duplicated.
        var existing = await SeedAsync(db => db.SeedUserAsync(displayName: "Legacy"));

        var resolved = await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, TestData.NewId(), existing.Email, "Legacy"));

        Assert.Equal(existing.UserId, resolved);
    }

    [Fact]
    public async Task PrefersTheOidMatchWhenTheEmailBelongsToAnotherUser()
    {
        // Identity ambiguity: the oid says one account, the email says another. The oid wins,
        // and — critically — the email is not copied across. Cosmos has no unique index on Email
        // to catch a duplicate, and GetCallerUserIdAsync's email path uses FirstOrDefaultAsync,
        // so two users sharing an address would make a later email-only token resolve to
        // whichever document came back first.
        var oid = TestData.NewId();
        var ownEmail = TestData.NewEmail("own");
        await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, ownEmail, "Owner"));
        var other = await SeedAsync(db => db.SeedUserAsync(displayName: "Someone Else"));

        var resolved = await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, other.Email, "Owner"));

        Assert.Equal(oid, resolved);
        Assert.Equal(ownEmail, (await UserAsync(oid))!.Email);
        Assert.Equal(other.Email, (await UserAsync(other.UserId))!.Email);
    }

    [Fact]
    public async Task NoTwoUsersEndUpSharingAnEmailAddress()
    {
        // The consequence the guard above exists to prevent, asserted directly against the store.
        var oid = TestData.NewId();
        await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, TestData.NewEmail("own"), "Owner"));
        var other = await SeedAsync(db => db.SeedUserAsync(displayName: "Someone Else"));

        await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, other.Email, "Owner"));

        var sharing = await Fixture.WithDbAsync(db =>
            db.Users.AsNoTracking().Where(u => u.Email == other.Email).ToListAsync());

        Assert.Single(sharing);
        Assert.Equal(other.UserId, sharing[0].UserId);
    }

    [Fact]
    public async Task StillRefreshesAChangedEmailThatNobodyElseHolds()
    {
        // The ambiguity guard must not block the ordinary case it sits in front of.
        var oid = TestData.NewId();
        await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, TestData.NewEmail("before"), "Mover"));

        var newEmail = TestData.NewEmail("after");
        await Fixture.WithDbAsync(db =>
            AzureDirectoryAuthorization.EnsureUserExistsAsync(db, oid, newEmail, "Mover"));

        Assert.Equal(newEmail, (await UserAsync(oid))!.Email);
    }

    // --- GetCallerUserIdAsync ---

    [Fact]
    public async Task GetCallerUserId_ProvisionsAUserFromABearerToken()
    {
        var oid = TestData.NewId();
        var request = TestRequest.For(oid, TestData.NewEmail(), "Token Holder");

        var resolved = await Fixture.WithDbAsync(db => request.GetCallerUserIdAsync(db));

        Assert.Equal(oid, resolved);
        Assert.NotNull(await UserAsync(oid));
    }

    [Fact]
    public async Task GetCallerUserId_ReturnsNullForAnAnonymousRequest()
    {
        var request = TestRequest.Anonymous();

        Assert.Null(await Fixture.WithDbAsync(db => request.GetCallerUserIdAsync(db)));
    }

    [Fact]
    public async Task GetCallerUserId_ReturnsNullForAnExpiredToken()
    {
        var expired = TestRequest.WithAuthorizationHeader($"Bearer {TestRequest.UnsignedJwt(new Dictionary<string, object>
        {
            ["oid"] = TestData.NewId().ToString(),
            ["exp"] = DateTimeOffset.UtcNow.AddMinutes(-5).ToUnixTimeSeconds(),
        })}");

        Assert.Null(await Fixture.WithDbAsync(db => expired.GetCallerUserIdAsync(db)));
    }

    [Fact]
    public async Task GetCallerUserId_IsStableAcrossRepeatedRequests()
    {
        var oid = TestData.NewId();
        var email = TestData.NewEmail();

        var first = await Fixture.WithDbAsync(db => TestRequest.For(oid, email, "Stable").GetCallerUserIdAsync(db));
        var second = await Fixture.WithDbAsync(db => TestRequest.For(oid, email, "Stable").GetCallerUserIdAsync(db));

        Assert.Equal(first, second);
        Assert.Single(await UsersWithOidAsync(oid));
    }

    [Fact]
    public async Task GetCallerUserId_ResolvesAnEmailOnlyTokenToAnExistingUser()
    {
        var existing = await SeedAsync(db => db.SeedUserAsync(displayName: "Email Only"));
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object>
        {
            ["sub"] = "not-a-guid",
            ["email"] = existing.Email,
            ["exp"] = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds(),
        });

        var resolved = await Fixture.WithDbAsync(db =>
            TestRequest.WithAuthorizationHeader($"Bearer {token}").GetCallerUserIdAsync(db));

        Assert.Equal(existing.UserId, resolved);
    }

    [Fact]
    public async Task GetCallerUserId_CreatesAUserForAnUnknownEmailOnlyToken()
    {
        var email = TestData.NewEmail("brandnew");
        var token = TestRequest.UnsignedJwt(new Dictionary<string, object>
        {
            ["sub"] = "not-a-guid",
            ["email"] = email,
            ["exp"] = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds(),
        });

        var resolved = await Fixture.WithDbAsync(db =>
            TestRequest.WithAuthorizationHeader($"Bearer {token}").GetCallerUserIdAsync(db));

        Assert.NotNull(resolved);
        var created = await Fixture.WithDbAsync(db =>
            db.Users.AsNoTracking().SingleAsync(u => u.UserId == resolved!.Value));
        Assert.Equal(email, created.Email);
    }

    [Fact]
    public async Task GetCallerUserId_ProvisionsFromTheEasyAuthClientPrincipalToo()
    {
        var oid = TestData.NewId();
        var request = TestRequest.WithClientPrincipal(
            ("oid", oid.ToString()),
            ("email", TestData.NewEmail("easyauth")),
            ("name", "EasyAuth User"));

        var resolved = await Fixture.WithDbAsync(db => request.GetCallerUserIdAsync(db));

        Assert.Equal(oid, resolved);
        Assert.Equal("EasyAuth User", (await UserAsync(oid))!.DisplayName);
    }
}
