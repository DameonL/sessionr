using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SessionApp.Api.Data;

namespace SessionApp.Api.UnitTests.Data;

/// <summary>
/// Provider selection is a single branch, but it is the branch that decides whether the app talks
/// to a local file or to production Cosmos, so it is worth pinning explicitly.
/// </summary>
public class DbSetupTests
{
    private const string EmulatorKey =
        "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

    private const string CosmosConnectionString =
        $"AccountEndpoint=https://localhost:8081/;AccountKey={EmulatorKey};";

    private static string ProviderFor(string? connectionString, string? databaseName = null)
    {
        var services = new ServiceCollection();
        services.AddSessionAppDbContext(connectionString, databaseName);
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        return scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.ProviderName!;
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void FallsBackToSqliteWithoutAGenuineCosmosConnectionString(string? connectionString)
    {
        Assert.Equal("Microsoft.EntityFrameworkCore.Sqlite", ProviderFor(connectionString));

        var services = new ServiceCollection();
        Assert.True(services.AddSessionAppDbContext(connectionString, null), "should report running on SQLite");
    }

    [Fact]
    public void UsesCosmosWhenGivenAConnectionString()
    {
        Assert.Equal("Microsoft.EntityFrameworkCore.Cosmos", ProviderFor(CosmosConnectionString, "sessionr"));

        var services = new ServiceCollection();
        Assert.False(services.AddSessionAppDbContext(CosmosConnectionString, "sessionr"),
            "should report running on Cosmos");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void DefaultsTheCosmosDatabaseNameWhenNoneIsGiven(string? databaseName)
    {
        // A blank name must fall back to "sessionr" rather than provisioning a blank database.
        Assert.Equal("Microsoft.EntityFrameworkCore.Cosmos", ProviderFor(CosmosConnectionString, databaseName));
    }

    [Fact]
    public void TheParameterlessOverloadReadsTheEnvironment()
    {
        // No Cosmos connection string is set in the test process, so this is the dev path.
        var services = new ServiceCollection();

        Assert.True(services.AddSessionAppDbContext(), "an unconfigured process should run on SQLite");
    }

    [Fact]
    public void TheDevSqlitePathIsAnchoredToTheAssemblyNotTheWorkingDirectory()
    {
        // The Functions host launches the worker with its CWD set to bin/Debug/net10.0/, so a
        // CWD-relative path would give Public and Private a database each. The path is instead
        // built from the assembly location, four levels up — which lands on api/ for both apps.
        // Asserted here as the resolution *rule*, since in a test process those four levels land
        // on tests/ instead.
        var services = new ServiceCollection();
        services.AddSessionAppDbContext(null, null);
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        var connectionString = scope.ServiceProvider.GetRequiredService<AppDbContext>()
            .Database.GetConnectionString();

        var expected = Path.GetFullPath(
            Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "sessionapp.dev.db"));

        Assert.Equal($"Data Source={expected}", connectionString);
        Assert.DoesNotContain($"bin{Path.DirectorySeparatorChar}", connectionString);
    }
}
