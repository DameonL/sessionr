using System;
using System.IO;
using Microsoft.EntityFrameworkCore;
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

    /// <summary>Runs the one-off column-add shim and, for local SQLite, the dev seed. Idempotent — safe to call from both apps at startup.</summary>
    public static void InitializeDatabase(IServiceProvider services, bool useSqlite)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        if (!useSqlite)
        {
            db.Database.EnsureCreated();
        }

        try
        {
            db.Database.ExecuteSqlRaw("ALTER TABLE Tunes ADD TheSessionId INT NULL;");
        }
        catch
        {
            // Column already exists (or the provider doesn't need the shim) — fine either way.
        }

        if (useSqlite)
        {
            DbInitializer.InitializeDevDatabase(db);
        }
    }
}
