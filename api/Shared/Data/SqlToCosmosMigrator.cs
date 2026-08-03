using System;
using System.Collections.Generic;
using System.Linq;
using System.Linq.Expressions;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace SessionApp.Api.Data;

/// <summary>
/// One-time copy of the legacy Azure SQL data into Azure Cosmos DB for NoSQL. Idempotent: reads
/// every SQL row and inserts only those whose id is not already present in the target container,
/// so a partial or repeated run converges instead of failing on id conflicts. There are no foreign
/// keys in Cosmos, so entity order is irrelevant.
///
/// Exposed two ways: as a startup hook gated by the <c>RunMigrationOnStartup</c> app setting (so it
/// can run without any reachable HTTP endpoint, e.g. when the app sits behind EasyAuth/WAF), and via
/// the public HTTP function that calls <see cref="RunAsync"/> directly.
/// </summary>
public static class SqlToCosmosMigrator
{
    /// <summary>
    /// Runs the copy at startup only when the <c>RunMigrationOnStartup</c> app setting is "true"/"1"
    /// and both connection strings are present. Never throws — a migration problem must not take the
    /// worker down — and logs to stderr because logs emitted before app.Run() don't reach the host's
    /// gRPC log channel. Prefer running with the app scaled to a single instance to avoid two workers
    /// racing on the same insert.
    /// </summary>
    public static async Task RunIfRequestedAsync()
    {
        var flag = Environment.GetEnvironmentVariable("RunMigrationOnStartup");
        if (!string.Equals(flag, "true", StringComparison.OrdinalIgnoreCase) && flag != "1")
        {
            return;
        }

        var sqlConnectionString = Environment.GetEnvironmentVariable("SqlConnectionString");
        var cosmosConnectionString = Environment.GetEnvironmentVariable("CosmosConnectionString")
            ?? Environment.GetEnvironmentVariable("MongoConnectionString");
        var dbName = Environment.GetEnvironmentVariable("CosmosDatabaseName") ?? "sessionr";

        if (string.IsNullOrWhiteSpace(sqlConnectionString) || string.IsNullOrWhiteSpace(cosmosConnectionString))
        {
            Console.Error.WriteLine("[Migration] RunMigrationOnStartup is set but SqlConnectionString and/or CosmosConnectionString are missing; skipping.");
            return;
        }

        try
        {
            Console.Error.WriteLine("[Migration] Startup SQL -> Cosmos migration starting…");
            var counts = await RunAsync(sqlConnectionString, cosmosConnectionString, dbName);
            Console.Error.WriteLine("[Migration] Completed. Rows copied: " + string.Join(", ", counts.Select(kv => $"{kv.Key}={kv.Value}")));
            Console.Error.WriteLine("[Migration] Remove the RunMigrationOnStartup app setting now so it doesn't re-run on every restart.");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("[Migration] Startup migration FAILED (worker will still start): " + ex);
        }
    }

    /// <summary>Copies all entities from the SQL source into the Cosmos target and returns per-entity counts of rows added.</summary>
    public static async Task<Dictionary<string, int>> RunAsync(string sqlConnectionString, string cosmosConnectionString, string dbName)
    {
        var sourceOptions = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlServer(sqlConnectionString)
            .Options;
        using var sourceDb = new AppDbContext(sourceOptions);

        var targetOptions = new DbContextOptionsBuilder<AppDbContext>()
            .UseCosmos(cosmosConnectionString, dbName, cosmos => cosmos.ConnectionMode(Microsoft.Azure.Cosmos.ConnectionMode.Gateway))
            .Options;
        using var targetDb = new AppDbContext(targetOptions);

        await targetDb.Database.EnsureCreatedAsync();

        var counts = new Dictionary<string, int>();

        async Task CopyAsync<T>(string name, Func<AppDbContext, DbSet<T>> set, Expression<Func<T, Guid>> key) where T : class
        {
            var rows = await set(sourceDb).AsNoTracking().ToListAsync();
            var added = 0;
            if (rows.Count > 0)
            {
                var existing = (await set(targetDb).Select(key).ToListAsync()).ToHashSet();
                var keyFunc = key.Compile();
                var toAdd = rows.Where(r => !existing.Contains(keyFunc(r))).ToList();
                if (toAdd.Count > 0)
                {
                    set(targetDb).AddRange(toAdd);
                    await targetDb.SaveChangesAsync();
                    added = toAdd.Count;
                }
            }
            counts[name] = added;
        }

        await CopyAsync("Users", d => d.Users, u => u.UserId);
        await CopyAsync("Tunes", d => d.Tunes, t => t.TuneId);
        await CopyAsync("UserTunes", d => d.UserTunes, x => x.UserTuneId);
        await CopyAsync("Sets", d => d.Sets, x => x.SetId);
        await CopyAsync("SetItems", d => d.SetItems, x => x.SetItemId);
        await CopyAsync("Groups", d => d.Groups, x => x.GroupId);
        await CopyAsync("GroupMemberships", d => d.GroupMemberships, x => x.GroupMembershipId);
        await CopyAsync("GroupUpdates", d => d.GroupUpdates, x => x.GroupUpdateId);
        await CopyAsync("GroupMeetingSchedules", d => d.GroupMeetingSchedules, x => x.GroupMeetingScheduleId);
        await CopyAsync("GroupScheduleExceptions", d => d.GroupScheduleExceptions, x => x.GroupScheduleExceptionId);
        await CopyAsync("GroupTunes", d => d.GroupTunes, x => x.GroupTuneId);
        await CopyAsync("GroupSets", d => d.GroupSets, x => x.GroupSetId);
        await CopyAsync("GroupSetItems", d => d.GroupSetItems, x => x.GroupSetItemId);
        await CopyAsync("GroupSessions", d => d.GroupSessions, x => x.GroupSessionId);
        await CopyAsync("SessionRsvps", d => d.SessionRsvps, x => x.SessionRsvpId);
        await CopyAsync("PracticeLog", d => d.PracticeLog, x => x.PracticeLogId);
        await CopyAsync("EarTrainingProgress", d => d.EarTrainingProgress, x => x.EarTrainingProgressId);
        await CopyAsync("TuneAliases", d => d.TuneAliases, x => x.TuneAliasId);
        await CopyAsync("TuneSettings", d => d.TuneSettings, x => x.TuneSettingId);
        await CopyAsync("TuneSettingVotes", d => d.TuneSettingVotes, x => x.TuneSettingVoteId);
        await CopyAsync("GroupFeedEvents", d => d.GroupFeedEvents, x => x.GroupFeedEventId);
        await CopyAsync("PointsTransactions", d => d.PointsTransactions, x => x.PointsTransactionId);
        await CopyAsync("UserBadges", d => d.UserBadges, x => x.UserBadgeId);
        await CopyAsync("Friendships", d => d.Friendships, x => x.FriendshipId);

        return counts;
    }
}
