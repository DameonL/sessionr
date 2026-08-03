using System;
using System.IO;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;

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
        var cosmosConnectionString = Environment.GetEnvironmentVariable("CosmosConnectionString")
            ?? Environment.GetEnvironmentVariable("MongoConnectionString")
            ?? Environment.GetEnvironmentVariable("SqlConnectionString");
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
                options.UseCosmos(cosmosConnectionString!, dbName);
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
            db.Database.EnsureCreated();
        }
    }
}
