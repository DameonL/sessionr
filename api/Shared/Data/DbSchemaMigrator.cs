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

                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PointsTransactions')
                    CREATE TABLE PointsTransactions (
                        PointsTransactionId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                        UserId UNIQUEIDENTIFIER NOT NULL,
                        Points INT NOT NULL,
                        Reason NVARCHAR(30) NOT NULL,
                        SourceId NVARCHAR(200) NULL,
                        CreatedAt DATETIME2 NOT NULL,
                        CONSTRAINT FK_PointsTransactions_Users FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE,
                        CONSTRAINT UQ_PointsTransactions_User_Reason_Source UNIQUE (UserId, Reason, SourceId)
                    );

                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UserBadges')
                    CREATE TABLE UserBadges (
                        UserBadgeId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                        UserId UNIQUEIDENTIFIER NOT NULL,
                        BadgeKey NVARCHAR(50) NOT NULL,
                        EarnedAt DATETIME2 NOT NULL,
                        CONSTRAINT FK_UserBadges_Users FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE,
                        CONSTRAINT UQ_UserBadges_User_BadgeKey UNIQUE (UserId, BadgeKey)
                    );
            """);
        }
        else
        {
            ExecuteSqlSafe(db, "ALTER TABLE Users ADD COLUMN Bio TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Users ADD COLUMN Location TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Users ADD COLUMN Instruments TEXT NULL;");

            ExecuteSqlSafe(db, """
                CREATE TABLE IF NOT EXISTS PointsTransactions (
                    PointsTransactionId TEXT NOT NULL PRIMARY KEY,
                    UserId TEXT NOT NULL,
                    Points INTEGER NOT NULL,
                    Reason TEXT NOT NULL,
                    SourceId TEXT NULL,
                    CreatedAt TEXT NOT NULL,
                    CONSTRAINT UQ_PointsTransactions_User_Reason_Source UNIQUE (UserId, Reason, SourceId)
                );
            """);
            ExecuteSqlSafe(db, """
                CREATE TABLE IF NOT EXISTS UserBadges (
                    UserBadgeId TEXT NOT NULL PRIMARY KEY,
                    UserId TEXT NOT NULL,
                    BadgeKey TEXT NOT NULL,
                    EarnedAt TEXT NOT NULL,
                    CONSTRAINT UQ_UserBadges_User_BadgeKey UNIQUE (UserId, BadgeKey)
                );
            """);
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
