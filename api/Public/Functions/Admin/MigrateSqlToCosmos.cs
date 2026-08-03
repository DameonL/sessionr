using System;
using System.Collections.Generic;
using System.Linq;
using System.Linq.Expressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;

namespace SessionApp.Api.Functions.Admin;

/// <summary>
/// One-time public data copy from the legacy Azure SQL database into Azure Cosmos DB for NoSQL.
/// Lives on the PUBLIC app on purpose: the Private app sits behind EasyAuth, which no one can pass
/// until Cosmos has user records, so a private endpoint would be unreachable during the very migration
/// that seeds it. Anonymous and idempotent (re-running only copies rows the target is still missing),
/// so it is safe to trigger from a public button. Remove once the copy is confirmed.
/// </summary>
public class MigrateSqlToCosmos
{
    [Function("MigrateSqlToCosmos")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "admin/migrate-sql-to-cosmos")] HttpRequest req)
    {
        var sqlConnectionString = Environment.GetEnvironmentVariable("SqlConnectionString");
        var cosmosConnectionString = Environment.GetEnvironmentVariable("CosmosConnectionString")
            ?? Environment.GetEnvironmentVariable("MongoConnectionString");

        if (string.IsNullOrWhiteSpace(sqlConnectionString))
        {
            return new BadRequestObjectResult(new { error = "SqlConnectionString environment variable is required as the source database connection (set it on the Public Function App)." });
        }

        if (string.IsNullOrWhiteSpace(cosmosConnectionString))
        {
            return new BadRequestObjectResult(new { error = "CosmosConnectionString environment variable is required as the target database connection." });
        }

        var dbName = Environment.GetEnvironmentVariable("CosmosDatabaseName") ?? "sessionr";

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

        // Reads every row from SQL and adds only those whose id isn't already in the Cosmos container,
        // so a partial or repeated run converges instead of failing on id conflicts. There are no FK
        // constraints in Cosmos, so entity order does not matter.
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

        return new OkObjectResult(new
        {
            success = true,
            message = "Migration from Azure SQL to Cosmos DB for NoSQL completed successfully.",
            counts
        });
    }
}
