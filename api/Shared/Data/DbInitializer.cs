using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Models;

namespace SessionApp.Api.Data;

/// <summary>
/// Creates and seeds the local SQLite dev database. Production (Azure SQL)
/// is managed by EF migrations instead and never runs this.
/// </summary>
public static class DbInitializer
{
    public static void InitializeDevDatabase(AppDbContext db)
    {
        db.Database.EnsureCreated();
        EnsureSchemaUpToDate(db);

        if (db.Tunes.Any())
        {
            return;
        }

        var user = new User { DisplayName = "Dev Musician", Email = "dev@example.com" };
        db.Users.Add(user);

        var tunes = SeedTunes();
        db.Tunes.AddRange(tunes);
        db.SaveChanges();

        var settings = new System.Collections.Generic.List<TuneSetting>();
        foreach (var t in tunes)
        {
            var s = new TuneSetting
            {
                TuneId = t.TuneId,
                Key = t.Key,
                AbcText = t.MasterAbcText,
                SubmitterName = "System",
                VoteScore = 3
            };
            settings.Add(s);
        }

        var cooleys = tunes[1];
        var cooleysAlternate = new TuneSetting
        {
            TuneId = cooleys.TuneId,
            Key = "Edor",
            AbcText = """
                X:1
                T:Cooley's (Alternate Setting)
                R:reel
                M:4/4
                L:1/8
                K:Edor
                |:EB{c}BA B2EB|~B2AB dBAG|FDAD BDAD|FDAD dAFD|
                EB{c}BA B2EB|~B2AB defg|afec dBAF|DEFD E2:|
                |:gf|eB~B2 efge|eB~B2 gedB|A2FA DAFA|A2FA defg|
                eB~B2 eBgB|eB~B2 defg|afec dBAF|DEFD E2:|
                """,
            SubmitterName = "Siobhan",
            VoteScore = 5
        };
        settings.Add(cooleysAlternate);

        var aliases = new System.Collections.Generic.List<TuneAlias>
        {
            new() { TuneId = tunes[0].TuneId, Name = "The Kesh Jig" },
            new() { TuneId = tunes[1].TuneId, Name = "Cooley's Reel" },
            new() { TuneId = tunes[3].TuneId, Name = "The Butterfly Slip Jig" }
        };

        db.TuneSettings.AddRange(settings);
        db.TuneAliases.AddRange(aliases);
        db.SaveChanges();

        // Give the dev user a spread of statuses/ages so the practice queue,
        // rust predictor, and dashboard stats all have something to show.
        var now = DateTime.UtcNow;
        var userTunes = new System.Collections.Generic.List<UserTune>
        {
            New(tunes[0], TuneStatus.Active, now.AddDays(-2), 112),   // The Kesh
            New(tunes[1], TuneStatus.Active, now.AddDays(-45), 108),  // Cooley's (rusty)
            New(tunes[2], TuneStatus.Active, now.AddDays(-10), 110),  // The Banshee
            New(tunes[3], TuneStatus.Learning, now.AddDays(-1), 90),  // The Butterfly
            New(tunes[4], TuneStatus.Learning, null, 80),             // Out on the Ocean
            New(tunes[5], TuneStatus.Active, now.AddDays(-38), 112),  // The Silver Spear (rusty)
            New(tunes[6], TuneStatus.Active, now.AddDays(-5), 70),    // Si Bheag Si Mhor
            New(tunes[7], TuneStatus.Wishlist, null, null),           // Harvest Home
        };
        db.UserTunes.AddRange(userTunes);
        db.SaveChanges();

        // Practice history: a 3-day streak ending today plus scattered earlier
        // sessions, so the dashboard streak and chart have something to show.
        var today = now.Date;
        int[] daysAgoWithPractice = [0, 1, 2, 5, 6, 9, 14, 15, 21, 28];
        var log = daysAgoWithPractice.Select((daysAgo, i) => new PracticeLogEntry
        {
            UserTuneId = userTunes[i % 4].UserTuneId,
            PracticedAt = today.AddDays(-daysAgo).AddHours(18),
        });
        db.PracticeLog.AddRange(log);
        db.SaveChanges();

        var set = new Set { UserId = user.UserId, Title = "G Session Starter" };
        db.Sets.Add(set);
        db.SaveChanges();

        db.SetItems.AddRange(
            new SetItem { SetId = set.SetId, UserTuneId = userTunes[0].UserTuneId, SequenceNumber = 1, Repetitions = 2 },
            new SetItem { SetId = set.SetId, UserTuneId = userTunes[2].UserTuneId, SequenceNumber = 2, Repetitions = 2 },
            new SetItem { SetId = set.SetId, UserTuneId = userTunes[1].UserTuneId, SequenceNumber = 3, Repetitions = 3 });
        db.SaveChanges();

        UserTune New(Tune tune, TuneStatus status, DateTime? lastPracticed, int? bpm)
        {
            var defaultSetting = db.TuneSettings.FirstOrDefault(s => s.TuneId == tune.TuneId && s.SubmitterName == "System");
            return new()
            {
                UserId = user.UserId,
                TuneId = tune.TuneId,
                TuneSettingId = defaultSetting?.TuneSettingId,
                Status = status,
                LastPracticed = lastPracticed,
                TargetBpm = bpm,
            };
        }
    }

    private static List<Tune> SeedTunes() =>
    [
        new()
        {
            Title = "The Kesh",
            TuneType = TuneType.Jig,
            Key = "G",
            MasterAbcText = """
                X:1
                T:The Kesh
                R:jig
                M:6/8
                L:1/8
                K:G
                |:G3 GAB|ABA ABd|edd gdd|edB dBA|
                G3 GAB|ABA ABd|edd gdd|BAF G3:|
                |:B2B d2d|ege dBA|B2B dBG|ABA AGA|
                B2B d2d|ege dBd|gfg aga|bgf g3:|
                """,
        },
        new()
        {
            Title = "Cooley's",
            TuneType = TuneType.Reel,
            Key = "Edor",
            MasterAbcText = """
                X:1
                T:Cooley's
                R:reel
                M:4/4
                L:1/8
                K:Edor
                |:D2|EBBA B2 EB|B2 AB dBAG|FDAD BDAD|FDAD dAFD|
                EBBA B2 EB|B2 AB defg|afec dBAF|DEFD E2:|
                |:gf|eB B2 efge|eB B2 gedB|A2 FA DAFA|A2 FA defg|
                eB B2 eBgB|eB B2 defg|afec dBAF|DEFD E2:|
                """,
        },
        new()
        {
            Title = "The Banshee",
            TuneType = TuneType.Reel,
            Key = "G",
            MasterAbcText = """
                X:1
                T:The Banshee
                R:reel
                M:4/4
                L:1/8
                K:G
                |:GABd eBdB|GABd e2 dB|GABd eBdB|A2 GA BGAG|
                GABd eBdB|GABd e2 dg|efge dega|bage dBAB:|
                |:G2 bg agbg|G2 bg agef|g2 gf gbag|efge dega|
                b2 bg agbg|G2 bg ageg|efge dega|bage dBAB:|
                """,
        },
        new()
        {
            Title = "The Butterfly",
            TuneType = TuneType.SlipJig,
            Key = "Em",
            MasterAbcText = """
                X:1
                T:The Butterfly
                R:slip jig
                M:9/8
                L:1/8
                K:Em
                |:B2E G2E F3|B2E G2E FED|B2E G2E F3|B2d d2B AFD:|
                |:B2c e2f g3|B2d g2e dBA|B2c e2f g2a|b2a g2e dBA:|
                |:B3 B2A G2A|B3 BAB dBA|B3 B2A G2A|B2d g2e dBA:|
                """,
        },
        new()
        {
            Title = "Out on the Ocean",
            TuneType = TuneType.Jig,
            Key = "G",
            MasterAbcText = """
                X:1
                T:Out on the Ocean
                R:jig
                M:6/8
                L:1/8
                K:G
                |:GED G2A|B2A B2d|edd gdd|edB dBA|
                GED G2A|B2A B2d|edB dBA|BGG G3:|
                |:B2d g2g|aga bge|edd gdd|edB dBA|
                B2d g2g|aga bge|edB dBA|BGG G3:|
                """,
        },
        new()
        {
            Title = "The Silver Spear",
            TuneType = TuneType.Reel,
            Key = "D",
            MasterAbcText = """
                X:1
                T:The Silver Spear
                R:reel
                M:4/4
                L:1/8
                K:D
                |:FAAB AFED|FAAB ABde|fBBA Bcde|fBBA BcdB|
                FAAB AFED|FAAB ABde|fbba fede|fdec d2 dB:|
                |:faab afdf|abaf abde|fBBA Bcde|fBBA BcdB|
                faab afdf|abaf abde|fbba fede|fdec d2 dB:|
                """,
        },
        new()
        {
            Title = "Si Bheag Si Mhor",
            TuneType = TuneType.Waltz,
            Key = "D",
            MasterAbcText = """
                X:1
                T:Si Bheag Si Mhor
                R:waltz
                M:3/4
                L:1/8
                K:D
                |:A2|d4 e2|f4 ed|f2 a2 f2|e4 d2|B4 d2|A4 F2|A6-|A4 A2|
                d4 e2|f4 ed|f2 a2 f2|e4 dB|A2 F2 A2|E2 F2 E2|D6-|D4:|
                """,
        },
        new()
        {
            Title = "Harvest Home",
            TuneType = TuneType.Hornpipe,
            Key = "D",
            MasterAbcText = """
                X:1
                T:Harvest Home
                R:hornpipe
                M:4/4
                L:1/8
                K:D
                AG|:FAdf afdf|gece gece|FAdf afdf|edcB A2 AG|
                FAdf afdf|gece gece|fgaf gecA|d2 f2 d2:|
                """,
        },
        new()
        {
            Title = "Britches Full of Stitches",
            TuneType = TuneType.Polka,
            Key = "A",
            MasterAbcText = """
                X:1
                T:Britches Full of Stitches
                R:polka
                M:2/4
                L:1/8
                K:A
                |:A2 AB|cB A2|f2 e2|cB A2|
                A2 AB|cB A2|B2 cB|A4:|
                |:e2 f2|e2 cA|e2 f2|e2 cd|
                e2 f2|e2 cA|B2 cB|A4:|
                """,
        },
        new()
        {
            Title = "Morrison's",
            TuneType = TuneType.Jig,
            Key = "Edor",
            MasterAbcText = """
                X:1
                T:Morrison's
                R:jig
                M:6/8
                L:1/8
                K:Edor
                |:E3 B3|EBE AFD|EDE B2A|dAF DFA|
                E3 B3|EBE AFD|G3 FGA|dAG FED:|
                |:Bee fee|aee fee|Bee fee|a2g fed|
                Bee fee|aee fag|f2e d2B|BAB dBA:|
                """,
        },
    ];

    private static void EnsureSchemaUpToDate(AppDbContext db)
    {
        ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN Description TEXT NOT NULL DEFAULT '';");
        ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN City TEXT NULL;");
        ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN RecurrencePattern TEXT NOT NULL DEFAULT 'None';");
        ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN RecurrenceDayOfWeek INTEGER NULL;");
        ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN RecurrenceWeekOfMonth INTEGER NULL;");
        ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN StartDate TEXT NULL;");
        ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN MeetingTime TEXT NULL;");
        ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN MeetingScheduleText TEXT NULL;");
        ExecuteSqlSafe(db, "ALTER TABLE Groups ADD COLUMN MeetingDescription TEXT NULL;");

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
