using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Mvc;
using SessionApp.Api.Data;
using SessionApp.Api.Services;

namespace SessionApp.Api.IntegrationTests.Infrastructure;

/// <summary>
/// A throwaway Cosmos DB database, served by the Linux emulator in Docker, shared by every test in
/// the <see cref="CosmosCollection"/>.
///
/// Why not SQLite: the app's Cosmos model is not the same model. <c>AppDbContext</c> severs every
/// cross-document navigation under Cosmos, gives each entity its own self-partitioned container,
/// and drops the unique indexes — so query shapes that SQLite executes happily (cross-document
/// Includes, <c>AnyAsync(predicate)</c>, <c>GroupBy</c>) fail at runtime in production and pass in a
/// SQLite-backed test. These tests exist to catch exactly that class of bug.
///
/// The container is started once per run and the database is created once, because
/// <c>EnsureCreatedAsync</c> provisions one container per entity type (~26 of them) and that is by
/// far the slowest part of the fixture. Tests therefore isolate themselves by data — each seeds its
/// own user with a fresh id — rather than by recreating the database.
/// </summary>
public sealed class CosmosEmulatorFixture : IAsyncLifetime
{
    /// <summary>The emulator's well-known account key — public by design, identical everywhere.</summary>
    private const string EmulatorAccountKey =
        "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

    private const string EmulatorImage = "mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-preview";

    private const ushort GatewayPort = 8081;
    private const ushort HealthPort = 8080;

    private IContainer? _emulator;
    private ServiceProvider? _services;

    /// <summary>The database name, unique per run so a leftover or parallel run can never collide.</summary>
    public string DatabaseName { get; } = $"sessionr-test-{Guid.CreateVersion7():N}";

    public string ConnectionString { get; private set; } = string.Empty;

    public async ValueTask InitializeAsync()
    {
        _emulator = new ContainerBuilder(EmulatorImage)
            .WithPortBinding(GatewayPort, assignRandomHostPort: true)
            .WithPortBinding(HealthPort, assignRandomHostPort: true)
            // Plain HTTP: the emulator supports it natively, and it spares every test process from
            // having to install or bypass the emulator's self-signed certificate.
            .WithEnvironment("PROTOCOL", "http")
            .WithEnvironment("ENABLE_EXPLORER", "false")
            // The gateway starts accepting TCP connections well before it will serve data-plane
            // requests. The health endpoint is the honest readiness signal.
            .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(request => request
                .ForPort(HealthPort)
                .ForPath("/")
                .ForStatusCode(System.Net.HttpStatusCode.OK)))
            .Build();

        await _emulator.StartAsync();

        ConnectionString =
            $"AccountEndpoint=http://{_emulator.Hostname}:{_emulator.GetMappedPublicPort(GatewayPort)}/;" +
            $"AccountKey={EmulatorAccountKey};";

        var services = new ServiceCollection();
        // Deliberately the production registration path (Gateway mode, the real Cosmos options),
        // so a change to how the app configures Cosmos is a change these tests run against.
        services.AddSessionAppDbContext(ConnectionString, DatabaseName);
        services.AddSingleton<SetAnalyzer>();
        services.AddSingleton<TuneHeuristics>();
        services.AddSingleton<TuneMatchIndex>();
        services.AddHttpClient();
        services.AddScoped<GamificationService>();
        _services = services.BuildServiceProvider();

        await CreateDatabaseAsync();
    }

    public async ValueTask DisposeAsync()
    {
        if (_services is not null)
        {
            // Drop the whole test database so a developer's emulator doesn't accumulate one per run.
            try
            {
                await using var scope = _services.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureDeletedAsync();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[CosmosEmulatorFixture] Could not drop {DatabaseName}: {ex.Message}");
            }

            await _services.DisposeAsync();
        }

        if (_emulator is not null)
        {
            await _emulator.DisposeAsync();
        }
    }

    /// <summary>A fresh scope and its <see cref="AppDbContext"/>, mirroring one request's DI scope.</summary>
    public AsyncServiceScope NewScope() => _services!.CreateAsyncScope();

    /// <summary>Runs <paramref name="action"/> against its own scoped context, like a single request would.</summary>
    public async Task<T> WithDbAsync<T>(Func<AppDbContext, Task<T>> action)
    {
        await using var scope = NewScope();
        return await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    public async Task WithDbAsync(Func<AppDbContext, Task> action)
    {
        await using var scope = NewScope();
        await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    /// <summary>
    /// Constructs a Function class the way the Functions host does — from the DI container, in its
    /// own request scope — and invokes it. Going through the real class (rather than re-issuing its
    /// query from the test) is the point: the query code, the auth check and the DTO projection are
    /// all covered, and none of it needs a Functions host or an HTTP listener.
    /// </summary>
    public async Task<TResult> InvokeAsync<TFunction, TResult>(Func<TFunction, Task<TResult>> invoke)
        where TFunction : notnull
    {
        await using var scope = NewScope();
        var function = ActivatorUtilities.CreateInstance<TFunction>(scope.ServiceProvider);
        return await invoke(function);
    }

    private async Task CreateDatabaseAsync()
    {
        await using var scope = _services!.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // The health check says the gateway is up, but the very first data-plane call can still
        // race the emulator finishing its own initialization. A short retry is cheaper and far more
        // stable than padding the wait strategy with a fixed sleep.
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await db.Database.EnsureCreatedAsync();
                return;
            }
            catch (Exception) when (attempt < 5)
            {
                await Task.Delay(TimeSpan.FromSeconds(attempt * 2));
            }
        }
    }
}

/// <summary>
/// Binds every Cosmos-backed test to the one emulator instance. xUnit runs a collection's tests
/// serially, which is what we want here: one emulator, and shared static caches inside the API
/// (notably <c>AzureDirectoryAuthorization</c>'s user cache) that concurrent tests would trip over.
/// </summary>
[CollectionDefinition(Name)]
public class CosmosCollection : ICollectionFixture<CosmosEmulatorFixture>
{
    public const string Name = "cosmos-emulator";
}

/// <summary>Base class for the Cosmos-backed tests: wires up the fixture and the seeding helpers.</summary>
[Collection(CosmosCollection.Name)]
public abstract class CosmosTestBase(CosmosEmulatorFixture fixture)
{
    protected CosmosEmulatorFixture Fixture { get; } = fixture;

    /// <summary>Seeds data through its own scope, exactly as a prior request would have written it.</summary>
    protected Task<T> SeedAsync<T>(Func<AppDbContext, Task<T>> seed) => Fixture.WithDbAsync(seed);

    protected Task SeedAsync(Func<AppDbContext, Task> seed) => Fixture.WithDbAsync(seed);

    /// <summary>Invokes a Function class in its own request scope. See <see cref="CosmosEmulatorFixture.InvokeAsync"/>.</summary>
    protected Task<TResult> InvokeAsync<TFunction, TResult>(Func<TFunction, Task<TResult>> invoke)
        where TFunction : notnull => Fixture.InvokeAsync(invoke);

    /// <summary>Unwraps an <see cref="OkObjectResult"/>'s payload, failing the test if the call did not succeed.</summary>
    protected static T Ok<T>(IActionResult result)
    {
        if (result is ObjectResult { StatusCode: >= 400 } error)
        {
            Assert.Fail($"Expected a successful result, got {error.StatusCode}: {error.Value}");
        }
        var ok = Assert.IsType<OkObjectResult>(result);
        return Assert.IsType<T>(ok.Value);
    }

    /// <summary>Asserts the endpoint refused the call with the given status code, and returns the body.</summary>
    protected static object? AssertStatus(int expected, IActionResult result)
    {
        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result);
        Assert.Equal(expected, objectResult.StatusCode);
        return objectResult.Value;
    }
}
