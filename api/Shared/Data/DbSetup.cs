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
    /// <summary>Registers AppDbContext and returns whether it's running against local SQLite (vs. Azure SQL).</summary>
    public static bool AddSessionAppDbContext(this IServiceCollection services)
    {
        var sqlConnectionString = Environment.GetEnvironmentVariable("SqlConnectionString");
        var useSqlite = string.IsNullOrWhiteSpace(sqlConnectionString);

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
                options.UseSqlServer(sqlConnectionString);
            }
        });

        return useSqlite;
    }

    /// <summary>
    /// Brings the database schema up to date. For production (Azure SQL) this applies EF Core
    /// migrations; for local SQLite it builds the schema from the model and runs the dev seed.
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
            BaselineExistingSchema(db);
            db.Database.Migrate();
        }
    }

    /// <summary>
    /// The production database predates EF migrations: it was created by EnsureCreated plus the
    /// old hand-written migrator, so it already has the full schema but no __EFMigrationsHistory.
    /// Mark the initial migration as already-applied so the Migrate() call below treats it as done
    /// instead of trying to recreate existing tables. A brand-new (empty) database is left alone,
    /// so Migrate() builds it from scratch.
    /// </summary>
    private static void BaselineExistingSchema(AppDbContext db)
    {
        var schemaExists = db.Database.SqlQueryRaw<int>(
            "SELECT COUNT(*) AS Value FROM sys.tables WHERE name = 'Users'")
            .AsEnumerable().FirstOrDefault() > 0;

        if (!schemaExists || db.Database.GetAppliedMigrations().Any())
        {
            return;
        }

        var historyRepository = db.GetService<IHistoryRepository>();
        var firstMigrationId = db.Database.GetMigrations().First();

        db.Database.ExecuteSqlRaw(historyRepository.GetCreateIfNotExistsScript());

        // The IF NOT EXISTS guard handles the common case, but check-then-insert isn't atomic
        // across connections: two instances (Public/Private, each possibly multi-instance) can
        // both pass the check and race on the __EFMigrationsHistory primary key. If the row is
        // present after our insert throws, a concurrent startup won the race and we're done;
        // anything else (e.g. a permissions failure that left no row) still surfaces.
        try
        {
            db.Database.ExecuteSqlRaw(
                "IF NOT EXISTS (SELECT 1 FROM [__EFMigrationsHistory] WHERE [MigrationId] = {0}) " +
                "INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion]) VALUES ({0}, {1})",
                firstMigrationId, ProductInfo.GetVersion());
        }
        catch (Exception) when (db.Database.GetAppliedMigrations().Contains(firstMigrationId))
        {
        }
    }
}
