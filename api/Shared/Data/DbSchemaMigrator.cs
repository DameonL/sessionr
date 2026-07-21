using Microsoft.EntityFrameworkCore;

namespace SessionApp.Api.Data;

/// <summary>
/// Provides idempotent database schema migrations for both Azure SQL (SQL Server)
/// and local SQLite environments, ensuring production and dev databases stay up-to-date automatically.
/// </summary>
public static class DbSchemaMigrator
{
    public static void EnsureSchemaUpToDate(AppDbContext db, bool useSqlite)
    {
        if (!useSqlite)
        {
            // Azure SQL (SQL Server) Migration
            db.Database.ExecuteSqlRaw("""
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'Description')
                    ALTER TABLE Groups ADD Description NVARCHAR(MAX) NOT NULL DEFAULT '';

                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'City')
                    ALTER TABLE Groups ADD City NVARCHAR(256) NULL;

                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'RecurrencePattern')
                    ALTER TABLE Groups ADD RecurrencePattern NVARCHAR(64) NOT NULL DEFAULT 'None';

                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'RecurrenceDayOfWeek')
                    ALTER TABLE Groups ADD RecurrenceDayOfWeek INT NULL;

                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'RecurrenceWeekOfMonth')
                    ALTER TABLE Groups ADD RecurrenceWeekOfMonth INT NULL;

                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'StartDate')
                    ALTER TABLE Groups ADD StartDate DATETIME2 NULL;

                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'MeetingTime')
                    ALTER TABLE Groups ADD MeetingTime NVARCHAR(64) NULL;

                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'MeetingScheduleText')
                    ALTER TABLE Groups ADD MeetingScheduleText NVARCHAR(MAX) NULL;

                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'MeetingDescription')
                    ALTER TABLE Groups ADD MeetingDescription NVARCHAR(MAX) NULL;

                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tunes') AND name = 'TheSessionId')
                    ALTER TABLE Tunes ADD TheSessionId INT NULL;

                IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID('GroupUpdates') AND type in (N'U'))
                BEGIN
                    CREATE TABLE GroupUpdates (
                        GroupUpdateId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                        GroupId UNIQUEIDENTIFIER NOT NULL,
                        Title NVARCHAR(256) NOT NULL,
                        Content NVARCHAR(MAX) NOT NULL,
                        CreatedByUserId UNIQUEIDENTIFIER NOT NULL,
                        CreatedAt DATETIME2 NOT NULL,
                        CONSTRAINT FK_GroupUpdates_Groups_GroupId FOREIGN KEY (GroupId) REFERENCES Groups (GroupId) ON DELETE CASCADE,
                        CONSTRAINT FK_GroupUpdates_Users_CreatedByUserId FOREIGN KEY (CreatedByUserId) REFERENCES Users (UserId) ON DELETE NO ACTION
                    );
                END

                IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID('GroupMeetingSchedules') AND type in (N'U'))
                BEGIN
                    CREATE TABLE GroupMeetingSchedules (
                        GroupMeetingScheduleId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                        GroupId UNIQUEIDENTIFIER NOT NULL,
                        RecurrencePattern NVARCHAR(64) NOT NULL DEFAULT 'None',
                        RecurrenceDayOfWeek INT NULL,
                        RecurrenceWeekOfMonth INT NULL,
                        StartDate DATETIME2 NULL,
                        MeetingTime NVARCHAR(64) NULL,
                        MeetingScheduleText NVARCHAR(MAX) NULL,
                        MeetingDescription NVARCHAR(MAX) NULL,
                        CreatedAt DATETIME2 NOT NULL,
                        CONSTRAINT FK_GroupMeetingSchedules_Groups_GroupId FOREIGN KEY (GroupId) REFERENCES Groups (GroupId) ON DELETE CASCADE
                    );
                END
            """);
        }
        else
        {
            // SQLite Migration
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN Description TEXT NOT NULL DEFAULT '';");
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN City TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN RecurrencePattern TEXT NOT NULL DEFAULT 'None';");
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN RecurrenceDayOfWeek INTEGER NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN RecurrenceWeekOfMonth INTEGER NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN StartDate TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN MeetingTime TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN MeetingScheduleText TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN MeetingDescription TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Tunes ADD COLUMN TheSessionId INTEGER NULL;");

            ExecuteSqlSafe(db, """
                CREATE TABLE IF NOT EXISTS GroupUpdates (
                    GroupUpdateId TEXT NOT NULL PRIMARY KEY,
                    GroupId TEXT NOT NULL,
                    Title TEXT NOT NULL,
                    Content TEXT NOT NULL,
                    CreatedByUserId TEXT NOT NULL,
                    CreatedAt TEXT NOT NULL,
                    FOREIGN KEY (GroupId) REFERENCES Groups (GroupId) ON DELETE CASCADE,
                    FOREIGN KEY (CreatedByUserId) REFERENCES Users (UserId) ON DELETE RESTRICT
                );
            """);

            ExecuteSqlSafe(db, """
                CREATE TABLE IF NOT EXISTS GroupMeetingSchedules (
                    GroupMeetingScheduleId TEXT NOT NULL PRIMARY KEY,
                    GroupId TEXT NOT NULL,
                    RecurrencePattern TEXT NOT NULL DEFAULT 'None',
                    RecurrenceDayOfWeek INTEGER NULL,
                    RecurrenceWeekOfMonth INTEGER NULL,
                    StartDate TEXT NULL,
                    MeetingTime TEXT NULL,
                    MeetingScheduleText TEXT NULL,
                    MeetingDescription TEXT NULL,
                    CreatedAt TEXT NOT NULL,
                    FOREIGN KEY (GroupId) REFERENCES Groups (GroupId) ON DELETE CASCADE
                );
            """);
        }

        MigrateLegacyGroupSchedules(db, useSqlite);
    }

    private static void MigrateLegacyGroupSchedules(AppDbContext db, bool useSqlite)
    {
        try
        {
            if (!useSqlite)
            {
                db.Database.ExecuteSqlRaw("""
                    INSERT INTO GroupMeetingSchedules (GroupMeetingScheduleId, GroupId, RecurrencePattern, RecurrenceDayOfWeek, RecurrenceWeekOfMonth, StartDate, MeetingTime, MeetingScheduleText, MeetingDescription, CreatedAt)
                    SELECT NEWID(), g.GroupId, g.RecurrencePattern, g.RecurrenceDayOfWeek, g.RecurrenceWeekOfMonth, g.StartDate, g.MeetingTime, g.MeetingScheduleText, g.MeetingDescription, GETUTCDATE()
                    FROM Groups g
                    WHERE (g.RecurrencePattern IS NOT NULL AND g.RecurrencePattern != 'None')
                      AND NOT EXISTS (SELECT 1 FROM GroupMeetingSchedules s WHERE s.GroupId = g.GroupId);
                """);
            }
            else
            {
                db.Database.ExecuteSqlRaw("""
                    INSERT INTO GroupMeetingSchedules (GroupMeetingScheduleId, GroupId, RecurrencePattern, RecurrenceDayOfWeek, RecurrenceWeekOfMonth, StartDate, MeetingTime, MeetingScheduleText, MeetingDescription, CreatedAt)
                    SELECT hex(randomblob(16)), g.GroupId, g.RecurrencePattern, g.RecurrenceDayOfWeek, g.RecurrenceWeekOfMonth, g.StartDate, g.MeetingTime, g.MeetingScheduleText, g.MeetingDescription, datetime('now')
                    FROM Groups g
                    WHERE (g.RecurrencePattern IS NOT NULL AND g.RecurrencePattern != 'None')
                      AND NOT EXISTS (SELECT 1 FROM GroupMeetingSchedules s WHERE s.GroupId = g.GroupId);
                """);
            }
        }
        catch
        {
            // Ignore if legacy columns are not present or already migrated
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
            // Ignore if column or table already exists in SQLite
        }
    }
}
