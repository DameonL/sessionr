using System;
using System.IO;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace SessionApp.Api.Data;

/// <summary>
/// Shared DbContext + dev-database bootstrap used identically by the Public and
/// Private Functions apps, so both processes agree on where the local SQLite
/// file lives (a sibling of both project folders) and stay schema-in-sync.
/// </summary>
public static class DbSetup
{
    /// <summary>Registers AppDbContext and returns whether it's running against local SQLite (vs. Cosmos DB).</summary>
    public static bool AddSessionAppDbContext(this IServiceCollection services)
    {
        // Only a genuine Cosmos connection string may drive the runtime context. SqlConnectionString
        // is deliberately NOT a fallback here: it belongs to the old SQL backend and is consumed only
        // by the one-time MigrateSqlToCosmos export. Feeding a SQL connection string to UseCosmos throws
        // "missing a required property: AccountEndpoint" at EnsureCreated and takes the worker down at
        // startup — which is exactly the failure this guard prevents.
        var cosmosConnectionString = Environment.GetEnvironmentVariable("CosmosConnectionString")
            ?? Environment.GetEnvironmentVariable("MongoConnectionString");
        var useSqlite = string.IsNullOrWhiteSpace(cosmosConnectionString);

        services.AddDbContext<AppDbContext>(options =>
        {
            if (useSqlite)
            {
                // The Azure Functions host launches the worker with its CWD set to
                // bin/Debug/net10.0/, not the project directory, so a path relative to
                // CWD silently diverges between Public and Private (each would create
                // its own file under its own bin/ folder). Anchor to the assembly's
                // location instead: .../api/{Public,Private}/bin/Debug/net10.0/ -> up
                // four levels lands on api/, a sibling both apps agree on.
                var dbPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "sessionapp.dev.db"));
                options.UseSqlite($"Data Source={dbPath}");
            }
            else
            {
                var dbName = Environment.GetEnvironmentVariable("CosmosDatabaseName") ?? "sessionr";
                options.UseCosmos(cosmosConnectionString!, dbName, cosmos =>
                {
                    // Gateway mode is the recommended connection mode for Azure Functions: Direct mode
                    // needs outbound TCP on ports 10000-20000 (restricted on Functions plans) and pulls
                    // in the native ServiceInterop component, which can hard-crash the worker on some
                    // hosting platforms. Gateway routes everything over HTTPS/443.
                    cosmos.ConnectionMode(Microsoft.Azure.Cosmos.ConnectionMode.Gateway);
                });
            }
        });

        return useSqlite;
    }

    /// <summary>
    /// Brings the database schema up to date. For production (Cosmos DB) this ensures the database
    /// and containers exist; for local SQLite it builds the schema from the model and runs the dev seed.
    /// Safe to call from both the Public and Private apps at startup.
    /// </summary>
    public static void InitializeDatabase(IServiceProvider services, bool useSqlite)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        if (useSqlite)
        {
            // The dev SQLite file is disposable and rebuilt on startup, so EnsureCreated
            // builds the full current schema straight from the model (no migrations).
            DbInitializer.InitializeDevDatabase(db);
        }
        else
        {
            // EnsureCreated is the first time we actually reach Cosmos. It runs in Program.Main
            // before app.Run(), so any exception here kills the isolated worker at startup and the
            // Functions host only reports "worker exited" with no detail. Log the real cause first.
            try
            {
                db.Database.EnsureCreated();
            }
            catch (Exception ex)
            {
                var logger = services.GetService<ILoggerFactory>()?.CreateLogger(typeof(DbSetup).FullName!);
                logger?.LogCritical(ex,
                    "Cosmos database initialization failed at startup. Verify CosmosConnectionString is a valid " +
                    "Cosmos DB for NoSQL connection string (AccountEndpoint=...;AccountKey=...) and that the account " +
                    "is reachable. The worker will now exit.");
                throw;
            }
        }
    }
}
