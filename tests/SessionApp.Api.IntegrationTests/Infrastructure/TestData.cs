using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;

namespace SessionApp.Api.IntegrationTests.Infrastructure;

/// <summary>
/// Minimal seed builders for the Cosmos-backed tests.
///
/// Every test owns its own user (a fresh UUID v7 and a unique email) rather than sharing a seeded
/// fixture, because the database is created once for the whole run and never reset between tests —
/// and because <c>AzureDirectoryAuthorization</c> memoizes oid -> userId in a process-wide static
/// cache for ten minutes, so reusing an id across tests would leak state between them.
/// </summary>
public static class TestData
{
    private static readonly TuneHeuristics Heuristics = new();

    public const string CooleysAbc = "K:Edor\nEBBA B2EB|B2AB dBAG|FDAD BDAD|FDAD dAGF:|";
    public const string DrowsyMaggieAbc = "K:Edor\nEBBA B2EB|B2AB defg|afec dBAF|DEFD E2ge:|";
    public const string BankOfIrelandAbc = "K:G\nGABc dedB|dedB dedB|GABc dedB|c2A2 AGEG:|";

    /// <summary>An id no test has used, so a test's rows are always distinguishable from its neighbours'.</summary>
    public static Guid NewId() => Guid.CreateVersion7();

    public static string NewEmail(string prefix = "player") => $"{prefix}-{Guid.CreateVersion7():N}@example.test";

    public static async Task<User> SeedUserAsync(
        this AppDbContext db,
        Guid? userId = null,
        string displayName = "Test Musician",
        string? username = null,
        int currentStreak = 0,
        DateTime? streakAnchorDate = null)
    {
        var user = new User
        {
            UserId = userId ?? NewId(),
            DisplayName = displayName,
            Username = username,
            Email = NewEmail(),
            CurrentStreak = currentStreak,
            StreakAnchorDate = streakAnchorDate,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    /// <summary>A master-list tune with its melodic heuristics computed, exactly as the import path writes it.</summary>
    public static async Task<Tune> SeedTuneAsync(
        this AppDbContext db,
        string title = "Cooley's",
        TuneType tuneType = TuneType.Reel,
        string key = "Edor",
        string? abc = null,
        bool isReviewed = true)
    {
        var tune = new Tune
        {
            Title = title,
            TuneType = tuneType,
            Key = key,
            MasterAbcText = abc ?? CooleysAbc,
            IsReviewed = isReviewed,
        };
        Heuristics.Apply(tune);
        db.Tunes.Add(tune);
        await db.SaveChangesAsync();
        return tune;
    }

    public static async Task<TuneSetting> SeedTuneSettingAsync(
        this AppDbContext db,
        Tune tune,
        string? abc = null,
        string? key = null,
        string submitterName = "Test Submitter",
        int voteScore = 0)
    {
        var setting = new TuneSetting
        {
            TuneId = tune.TuneId,
            Key = key ?? tune.Key,
            AbcText = abc ?? tune.MasterAbcText,
            SubmitterName = submitterName,
            VoteScore = voteScore,
        };
        db.TuneSettings.Add(setting);
        await db.SaveChangesAsync();
        return setting;
    }

    public static async Task<UserTune> SeedUserTuneAsync(
        this AppDbContext db,
        User user,
        Tune tune,
        TuneStatus status = TuneStatus.Active,
        DateTime? lastPracticed = null,
        Guid? tuneSettingId = null,
        string? customAbcText = null)
    {
        var userTune = new UserTune
        {
            UserId = user.UserId,
            TuneId = tune.TuneId,
            Status = status,
            LastPracticed = lastPracticed,
            TuneSettingId = tuneSettingId,
            CustomAbcText = customAbcText,
            TargetBpm = Tune.GetDefaultTargetBpm(tune.TuneType),
        };
        db.UserTunes.Add(userTune);
        await db.SaveChangesAsync();
        return userTune;
    }

    /// <summary>A set and its ordered items, written the Cosmos way — items keyed by SetId, not via the navigation.</summary>
    public static async Task<Set> SeedSetAsync(
        this AppDbContext db,
        User user,
        string title,
        params UserTune[] userTunes)
    {
        var set = new Set { UserId = user.UserId, Title = title };
        db.Sets.Add(set);

        for (var i = 0; i < userTunes.Length; i++)
        {
            db.SetItems.Add(new SetItem
            {
                SetId = set.SetId,
                UserTuneId = userTunes[i].UserTuneId,
                SequenceNumber = i + 1,
                Repetitions = 2,
            });
        }

        await db.SaveChangesAsync();
        return set;
    }

    public static async Task<Group> SeedGroupAsync(
        this AppDbContext db,
        User owner,
        string name = "Test Session",
        bool isPrivate = false,
        bool isReviewed = true)
    {
        var group = new Group
        {
            Name = name,
            Description = "Seeded by the integration tests.",
            IsPrivate = isPrivate,
            IsReviewed = isReviewed,
            InviteCode = Guid.CreateVersion7().ToString("N")[..8],
        };
        db.Groups.Add(group);
        db.GroupMemberships.Add(new GroupMembership
        {
            GroupId = group.GroupId,
            UserId = owner.UserId,
            Role = GroupRole.Owner,
            Status = GroupMembershipStatus.Active,
        });
        await db.SaveChangesAsync();
        return group;
    }

    public static async Task<GroupMembership> SeedMembershipAsync(
        this AppDbContext db,
        Group group,
        User user,
        GroupRole role = GroupRole.Member,
        GroupMembershipStatus status = GroupMembershipStatus.Active)
    {
        var membership = new GroupMembership
        {
            GroupId = group.GroupId,
            UserId = user.UserId,
            Role = role,
            Status = status,
        };
        db.GroupMemberships.Add(membership);
        await db.SaveChangesAsync();
        return membership;
    }

    public static async Task SeedPracticeAsync(this AppDbContext db, UserTune userTune, params DateTime[] practicedAt)
    {
        foreach (var at in practicedAt)
        {
            db.PracticeLog.Add(new PracticeLogEntry { UserTuneId = userTune.UserTuneId, PracticedAt = at });
        }
        await db.SaveChangesAsync();
    }
}
