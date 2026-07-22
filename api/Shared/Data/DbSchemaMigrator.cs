using Microsoft.EntityFrameworkCore;

namespace SessionApp.Api.Data;

/// <summary>
/// One-off database migration hook, run idempotently at startup by both the
/// Public and Private Functions apps (see DbSetup.InitializeDatabase). All
/// prior migrations have been fully applied to production and dev — this is
/// currently a no-op, kept as the place to add the next schema/data fixup.
/// </summary>
public static class DbSchemaMigrator
{
    public static void EnsureSchemaUpToDate(AppDbContext db, bool useSqlite)
    {
        if (!useSqlite)
        {
            db.Database.ExecuteSqlRaw("""
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'Bio')
                    ALTER TABLE Users ADD Bio NVARCHAR(MAX) NULL;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'Location')
                    ALTER TABLE Users ADD Location NVARCHAR(256) NULL;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'Instruments')
                    ALTER TABLE Users ADD Instruments NVARCHAR(512) NULL;
            """);
        }
        else
        {
            ExecuteSqlSafe(db, "ALTER TABLE Users ADD COLUMN Bio TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Users ADD COLUMN Location TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Users ADD COLUMN Instruments TEXT NULL;");
        }
    }

    private static void ExecuteSqlSafe(AppDbContext db, string sql)
    {
        try
        {
            db.Database.ExecuteSqlRaw(sql);
        }
        catch
        {
            // Ignore if the column already exists in SQLite.
        }
    }
}
