using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Services;

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
        bool addedStreakColumns = false;
        bool addedUsernameColumn = false;

        if (!useSqlite)
        {
            var colExists = db.Database.SqlQueryRaw<int>(
                "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'CurrentStreak'")
                .AsEnumerable().FirstOrDefault() > 0;

            if (!colExists)
            {
                db.Database.ExecuteSqlRaw("""
                    ALTER TABLE Users ADD CurrentStreak INT NOT NULL DEFAULT 0;
                    ALTER TABLE Users ADD StreakAnchorDate DATETIME2 NULL;
                """);
                addedStreakColumns = true;
            }

            var usernameColExists = db.Database.SqlQueryRaw<int>(
                "SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'Username'")
                .AsEnumerable().FirstOrDefault() > 0;

            if (!usernameColExists)
            {
                db.Database.ExecuteSqlRaw("ALTER TABLE Users ADD Username NVARCHAR(30) NULL;");
                addedUsernameColumn = true;
            }

            db.Database.ExecuteSqlRaw("""
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'Bio')
                    ALTER TABLE Users ADD Bio NVARCHAR(MAX) NULL;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'Location')
                    ALTER TABLE Users ADD Location NVARCHAR(256) NULL;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'Instruments')
                    ALTER TABLE Users ADD Instruments NVARCHAR(512) NULL;

                IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Users_Username' AND object_id = OBJECT_ID('Users'))
                    CREATE UNIQUE INDEX IX_Users_Username ON Users(Username) WHERE Username IS NOT NULL;

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
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tunes') AND name = 'IsReviewed')
                    ALTER TABLE Tunes ADD IsReviewed BIT NOT NULL DEFAULT 1;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tunes') AND name = 'ReviewedAt')
                    ALTER TABLE Tunes ADD ReviewedAt DATETIME2 NULL;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tunes') AND name = 'ReviewedBy')
                    ALTER TABLE Tunes ADD ReviewedBy NVARCHAR(256) NULL;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Tunes') AND name = 'CreatedAt')
                    ALTER TABLE Tunes ADD CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();

                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'TimeZone')
                    ALTER TABLE Groups ADD TimeZone NVARCHAR(64) NULL;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'IsReviewed')
                    ALTER TABLE Groups ADD IsReviewed BIT NOT NULL DEFAULT 1;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'ReviewedAt')
                    ALTER TABLE Groups ADD ReviewedAt DATETIME2 NULL;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'ReviewedBy')
                    ALTER TABLE Groups ADD ReviewedBy NVARCHAR(256) NULL;
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Groups') AND name = 'CreatedAt')
                    ALTER TABLE Groups ADD CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();
                IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('GroupMeetingSchedules') AND name = 'Name')
                    ALTER TABLE GroupMeetingSchedules ADD Name NVARCHAR(200) NULL;

                IF EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GroupSessions_StartsAt' AND object_id = OBJECT_ID('GroupSessions'))
                    DROP INDEX IX_GroupSessions_StartsAt ON GroupSessions;

                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GroupSessions')
                    CREATE TABLE GroupSessions (
                        GroupSessionId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                        GroupId UNIQUEIDENTIFIER NOT NULL,
                        Title NVARCHAR(200) NOT NULL,
                        Location NVARCHAR(200) NULL,
                        StartsAt DATETIME2 NOT NULL,
                        Notes NVARCHAR(MAX) NULL,
                        IsCancelled BIT NOT NULL DEFAULT 0,
                        CreatedByUserId UNIQUEIDENTIFIER NOT NULL,
                        CONSTRAINT FK_GroupSessions_Groups FOREIGN KEY (GroupId) REFERENCES Groups(GroupId) ON DELETE CASCADE,
                        CONSTRAINT FK_GroupSessions_Users FOREIGN KEY (CreatedByUserId) REFERENCES Users(UserId)
                    );

                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'SessionRsvps')
                    CREATE TABLE SessionRsvps (
                        SessionRsvpId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                        GroupSessionId UNIQUEIDENTIFIER NOT NULL,
                        UserId UNIQUEIDENTIFIER NOT NULL,
                        Status INT NOT NULL,
                        RespondedAt DATETIME2 NOT NULL,
                        CONSTRAINT FK_SessionRsvps_GroupSessions FOREIGN KEY (GroupSessionId) REFERENCES GroupSessions(GroupSessionId) ON DELETE CASCADE,
                        CONSTRAINT FK_SessionRsvps_Users FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE,
                        CONSTRAINT UQ_SessionRsvps_GroupSession_User UNIQUE (GroupSessionId, UserId)
                    );

                IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Friendships')
                    CREATE TABLE Friendships (
                        FriendshipId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
                        RequesterId UNIQUEIDENTIFIER NOT NULL,
                        ReceiverId UNIQUEIDENTIFIER NOT NULL,
                        Status NVARCHAR(20) NOT NULL,
                        CreatedAt DATETIME2 NOT NULL,
                        UpdatedAt DATETIME2 NOT NULL,
                        CONSTRAINT FK_Friendships_Requester FOREIGN KEY (RequesterId) REFERENCES Users(UserId) ON DELETE CASCADE,
                        CONSTRAINT FK_Friendships_Receiver FOREIGN KEY (ReceiverId) REFERENCES Users(UserId),
                        CONSTRAINT UQ_Friendships_Requester_Receiver UNIQUE (RequesterId, ReceiverId)
                    );

                IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_UserTunes_UserId_Status' AND object_id = OBJECT_ID('UserTunes'))
                    CREATE INDEX IX_UserTunes_UserId_Status ON UserTunes(UserId, Status);
                IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_UserTunes_UserId_LastPracticed' AND object_id = OBJECT_ID('UserTunes'))
                    CREATE INDEX IX_UserTunes_UserId_LastPracticed ON UserTunes(UserId, LastPracticed);
                IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_GroupSessions_GroupId_StartsAt' AND object_id = OBJECT_ID('GroupSessions'))
                    CREATE INDEX IX_GroupSessions_GroupId_StartsAt ON GroupSessions(GroupId, StartsAt);
                IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SessionRsvps_GroupSessionId_UserId' AND object_id = OBJECT_ID('SessionRsvps'))
                    CREATE UNIQUE INDEX IX_SessionRsvps_GroupSessionId_UserId ON SessionRsvps(GroupSessionId, UserId);
                IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_SessionRsvps_UserId' AND object_id = OBJECT_ID('SessionRsvps'))
                    CREATE INDEX IX_SessionRsvps_UserId ON SessionRsvps(UserId);
                IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Friendships_RequesterId_Status' AND object_id = OBJECT_ID('Friendships'))
                    CREATE INDEX IX_Friendships_RequesterId_Status ON Friendships(RequesterId, Status);
                IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Friendships_ReceiverId_Status' AND object_id = OBJECT_ID('Friendships'))
                    CREATE INDEX IX_Friendships_ReceiverId_Status ON Friendships(ReceiverId, Status);
            """);
        }
        else
        {
            var colExists = db.Database.SqlQueryRaw<string>(
                "SELECT name FROM pragma_table_info('Users') WHERE name = 'CurrentStreak'")
                .AsEnumerable().Any();

            if (!colExists)
            {
                ExecuteSqlSafe(db, "ALTER TABLE Users ADD COLUMN CurrentStreak INTEGER NOT NULL DEFAULT 0;");
                ExecuteSqlSafe(db, "ALTER TABLE Users ADD COLUMN StreakAnchorDate TEXT NULL;");
                addedStreakColumns = true;
            }

            var usernameColExists = db.Database.SqlQueryRaw<string>(
                "SELECT name FROM pragma_table_info('Users') WHERE name = 'Username'")
                .AsEnumerable().Any();

            if (!usernameColExists)
            {
                ExecuteSqlSafe(db, "ALTER TABLE Users ADD COLUMN Username TEXT NULL;");
                addedUsernameColumn = true;
            }

            ExecuteSqlSafe(db, "ALTER TABLE Users ADD COLUMN Bio TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Users ADD COLUMN Location TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Users ADD COLUMN Instruments TEXT NULL;");
            ExecuteSqlSafe(db, "CREATE UNIQUE INDEX IF NOT EXISTS IX_Users_Username ON Users(Username) WHERE Username IS NOT NULL;");

            ExecuteSqlSafe(db, "ALTER TABLE Tunes ADD COLUMN IsReviewed INTEGER NOT NULL DEFAULT 1;");
            ExecuteSqlSafe(db, "ALTER TABLE Tunes ADD COLUMN ReviewedAt TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Tunes ADD COLUMN ReviewedBy TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Tunes ADD COLUMN CreatedAt TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z';");

            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN TimeZone TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN IsReviewed INTEGER NOT NULL DEFAULT 1;");
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN ReviewedAt TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN ReviewedBy TEXT NULL;");
            ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN CreatedAt TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z';");
            ExecuteSqlSafe(db, "ALTER TABLE GroupMeetingSchedules ADD COLUMN Name TEXT NULL;");

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
            ExecuteSqlSafe(db, """
                CREATE TABLE IF NOT EXISTS GroupSessions (
                    GroupSessionId TEXT NOT NULL PRIMARY KEY,
                    GroupId TEXT NOT NULL,
                    Title TEXT NOT NULL,
                    Location TEXT NULL,
                    StartsAt TEXT NOT NULL,
                    Notes TEXT NULL,
                    IsCancelled INTEGER NOT NULL DEFAULT 0,
                    CreatedByUserId TEXT NOT NULL,
                    FOREIGN KEY (GroupId) REFERENCES Groups(GroupId) ON DELETE CASCADE,
                    FOREIGN KEY (CreatedByUserId) REFERENCES Users(UserId)
                );
            """);
            ExecuteSqlSafe(db, """
                CREATE TABLE IF NOT EXISTS SessionRsvps (
                    SessionRsvpId TEXT NOT NULL PRIMARY KEY,
                    GroupSessionId TEXT NOT NULL,
                    UserId TEXT NOT NULL,
                    Status INTEGER NOT NULL,
                    RespondedAt TEXT NOT NULL,
                    CONSTRAINT UQ_SessionRsvps_GroupSession_User UNIQUE (GroupSessionId, UserId),
                    FOREIGN KEY (GroupSessionId) REFERENCES GroupSessions(GroupSessionId) ON DELETE CASCADE,
                    FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE
                );
            """);

            ExecuteSqlSafe(db, """
                CREATE TABLE IF NOT EXISTS Friendships (
                    FriendshipId TEXT NOT NULL PRIMARY KEY,
                    RequesterId TEXT NOT NULL,
                    ReceiverId TEXT NOT NULL,
                    Status TEXT NOT NULL,
                    CreatedAt TEXT NOT NULL,
                    UpdatedAt TEXT NOT NULL,
                    CONSTRAINT UQ_Friendships_Requester_Receiver UNIQUE (RequesterId, ReceiverId),
                    FOREIGN KEY (RequesterId) REFERENCES Users(UserId) ON DELETE CASCADE,
                    FOREIGN KEY (ReceiverId) REFERENCES Users(UserId) ON DELETE CASCADE
                );
            """);

            ExecuteSqlSafe(db, "DROP INDEX IF EXISTS IX_GroupSessions_StartsAt;");
            ExecuteSqlSafe(db, "CREATE INDEX IF NOT EXISTS IX_UserTunes_UserId_Status ON UserTunes(UserId, Status);");
            ExecuteSqlSafe(db, "CREATE INDEX IF NOT EXISTS IX_UserTunes_UserId_LastPracticed ON UserTunes(UserId, LastPracticed);");
            ExecuteSqlSafe(db, "CREATE INDEX IF NOT EXISTS IX_GroupSessions_GroupId_StartsAt ON GroupSessions(GroupId, StartsAt);");
            ExecuteSqlSafe(db, "CREATE UNIQUE INDEX IF NOT EXISTS IX_SessionRsvps_GroupSessionId_UserId ON SessionRsvps(GroupSessionId, UserId);");
            ExecuteSqlSafe(db, "CREATE INDEX IF NOT EXISTS IX_SessionRsvps_UserId ON SessionRsvps(UserId);");
            ExecuteSqlSafe(db, "CREATE INDEX IF NOT EXISTS IX_Friendships_RequesterId_Status ON Friendships(RequesterId, Status);");
            ExecuteSqlSafe(db, "CREATE INDEX IF NOT EXISTS IX_Friendships_ReceiverId_Status ON Friendships(ReceiverId, Status);");
        }

        if (addedStreakColumns)
        {
            try
            {
                PerformStreakBackfill(db);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"EnsureSchemaUpToDate: PerformStreakBackfill warning/error: {ex.Message}");
            }
        }

        if (addedUsernameColumn)
        {
            try
            {
                PerformUsernameBackfill(db);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"EnsureSchemaUpToDate: PerformUsernameBackfill warning/error: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// Assigns every existing usernameless user a slug derived from their DisplayName,
    /// deterministically de-duplicating collisions with a numeric suffix (ordered by
    /// UserId so re-running against the same data always produces the same result).
    /// </summary>
    private static void PerformUsernameBackfill(AppDbContext db)
    {
        var users = db.Users.OrderBy(u => u.UserId).ToList();
        var taken = new HashSet<string>(StringComparer.Ordinal);

        foreach (var user in users)
        {
            var baseSlug = UsernameSlug.Slugify(user.DisplayName) ?? "musician";
            var candidate = baseSlug;
            var suffix = 2;
            while (taken.Contains(candidate))
            {
                var suffixStr = $"-{suffix}";
                var trimmedBase = baseSlug.Length + suffixStr.Length > 30
                    ? baseSlug[..(30 - suffixStr.Length)].TrimEnd('-')
                    : baseSlug;
                candidate = trimmedBase + suffixStr;
                suffix++;
            }
            taken.Add(candidate);
            user.Username = candidate;
        }

        db.SaveChanges();
    }

    private static void PerformStreakBackfill(AppDbContext db)
    {
        var now = DateTime.UtcNow;
        var users = db.Users.ToList();
        var practiceLogs = db.PracticeLog
            .AsNoTracking()
            .Select(p => new { p.UserTune.UserId, p.PracticedAt })
            .ToList()
            .GroupBy(p => p.UserId);

        foreach (var userGroup in practiceLogs)
        {
            var user = users.FirstOrDefault(u => u.UserId == userGroup.Key);
            if (user == null) continue;

            var timestamps = userGroup.Select(p => p.PracticedAt).ToList();
            var streak = PracticeStreakCalculator.ComputeCurrentStreak(timestamps, now);
            if (streak > 0)
            {
                var dates = timestamps.Select(t => t.Date).Distinct().ToHashSet();
                var today = now.Date;
                var anchor = dates.Contains(today) ? today : today.AddDays(-1);
                user.CurrentStreak = streak;
                user.StreakAnchorDate = anchor;
            }
        }

        db.SaveChanges();
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
