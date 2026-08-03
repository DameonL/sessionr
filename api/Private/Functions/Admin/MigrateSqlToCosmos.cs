using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions.Admin;

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
            return new BadRequestObjectResult(new { error = "SqlConnectionString environment variable is required as the source database connection." });
        }

        if (string.IsNullOrWhiteSpace(cosmosConnectionString))
        {
            return new BadRequestObjectResult(new { error = "CosmosConnectionString environment variable is required as the target database connection." });
        }

        var dbName = Environment.GetEnvironmentVariable("CosmosDatabaseName") ?? "sessionr";

        var sourceBuilder = new DbContextOptionsBuilder<AppDbContext>();
        sourceBuilder.UseSqlServer(sqlConnectionString);
        using var sourceDb = new AppDbContext(sourceBuilder.Options);

        var targetBuilder = new DbContextOptionsBuilder<AppDbContext>();
        targetBuilder.UseCosmos(cosmosConnectionString, dbName);
        using var targetDb = new AppDbContext(targetBuilder.Options);

        await targetDb.Database.EnsureCreatedAsync();

        var counts = new Dictionary<string, int>();

        // 1. Users
        var users = await sourceDb.Users.AsNoTracking().ToListAsync();
        if (users.Count > 0)
        {
            targetDb.Users.AddRange(users);
            await targetDb.SaveChangesAsync();
        }
        counts["Users"] = users.Count;

        // 2. Tunes
        var tunes = await sourceDb.Tunes.AsNoTracking().ToListAsync();
        if (tunes.Count > 0)
        {
            targetDb.Tunes.AddRange(tunes);
            await targetDb.SaveChangesAsync();
        }
        counts["Tunes"] = tunes.Count;

        // 3. UserTunes
        var userTunes = await sourceDb.UserTunes.AsNoTracking().ToListAsync();
        if (userTunes.Count > 0)
        {
            targetDb.UserTunes.AddRange(userTunes);
            await targetDb.SaveChangesAsync();
        }
        counts["UserTunes"] = userTunes.Count;

        // 4. Sets
        var sets = await sourceDb.Sets.AsNoTracking().ToListAsync();
        if (sets.Count > 0)
        {
            targetDb.Sets.AddRange(sets);
            await targetDb.SaveChangesAsync();
        }
        counts["Sets"] = sets.Count;

        // 5. SetItems
        var setItems = await sourceDb.SetItems.AsNoTracking().ToListAsync();
        if (setItems.Count > 0)
        {
            targetDb.SetItems.AddRange(setItems);
            await targetDb.SaveChangesAsync();
        }
        counts["SetItems"] = setItems.Count;

        // 6. Groups
        var groups = await sourceDb.Groups.AsNoTracking().ToListAsync();
        if (groups.Count > 0)
        {
            targetDb.Groups.AddRange(groups);
            await targetDb.SaveChangesAsync();
        }
        counts["Groups"] = groups.Count;

        // 7. GroupMemberships
        var groupMemberships = await sourceDb.GroupMemberships.AsNoTracking().ToListAsync();
        if (groupMemberships.Count > 0)
        {
            targetDb.GroupMemberships.AddRange(groupMemberships);
            await targetDb.SaveChangesAsync();
        }
        counts["GroupMemberships"] = groupMemberships.Count;

        // 8. GroupUpdates
        var groupUpdates = await sourceDb.GroupUpdates.AsNoTracking().ToListAsync();
        if (groupUpdates.Count > 0)
        {
            targetDb.GroupUpdates.AddRange(groupUpdates);
            await targetDb.SaveChangesAsync();
        }
        counts["GroupUpdates"] = groupUpdates.Count;

        // 9. GroupMeetingSchedules
        var groupMeetingSchedules = await sourceDb.GroupMeetingSchedules.AsNoTracking().ToListAsync();
        if (groupMeetingSchedules.Count > 0)
        {
            targetDb.GroupMeetingSchedules.AddRange(groupMeetingSchedules);
            await targetDb.SaveChangesAsync();
        }
        counts["GroupMeetingSchedules"] = groupMeetingSchedules.Count;

        // 10. GroupScheduleExceptions
        var groupScheduleExceptions = await sourceDb.GroupScheduleExceptions.AsNoTracking().ToListAsync();
        if (groupScheduleExceptions.Count > 0)
        {
            targetDb.GroupScheduleExceptions.AddRange(groupScheduleExceptions);
            await targetDb.SaveChangesAsync();
        }
        counts["GroupScheduleExceptions"] = groupScheduleExceptions.Count;

        // 11. GroupTunes
        var groupTunes = await sourceDb.GroupTunes.AsNoTracking().ToListAsync();
        if (groupTunes.Count > 0)
        {
            targetDb.GroupTunes.AddRange(groupTunes);
            await targetDb.SaveChangesAsync();
        }
        counts["GroupTunes"] = groupTunes.Count;

        // 12. GroupSets
        var groupSets = await sourceDb.GroupSets.AsNoTracking().ToListAsync();
        if (groupSets.Count > 0)
        {
            targetDb.GroupSets.AddRange(groupSets);
            await targetDb.SaveChangesAsync();
        }
        counts["GroupSets"] = groupSets.Count;

        // 13. GroupSetItems
        var groupSetItems = await sourceDb.GroupSetItems.AsNoTracking().ToListAsync();
        if (groupSetItems.Count > 0)
        {
            targetDb.GroupSetItems.AddRange(groupSetItems);
            await targetDb.SaveChangesAsync();
        }
        counts["GroupSetItems"] = groupSetItems.Count;

        // 14. GroupSessions
        var groupSessions = await sourceDb.GroupSessions.AsNoTracking().ToListAsync();
        if (groupSessions.Count > 0)
        {
            targetDb.GroupSessions.AddRange(groupSessions);
            await targetDb.SaveChangesAsync();
        }
        counts["GroupSessions"] = groupSessions.Count;

        // 15. SessionRsvps
        var sessionRsvps = await sourceDb.SessionRsvps.AsNoTracking().ToListAsync();
        if (sessionRsvps.Count > 0)
        {
            targetDb.SessionRsvps.AddRange(sessionRsvps);
            await targetDb.SaveChangesAsync();
        }
        counts["SessionRsvps"] = sessionRsvps.Count;

        // 16. PracticeLog
        var practiceLog = await sourceDb.PracticeLog.AsNoTracking().ToListAsync();
        if (practiceLog.Count > 0)
        {
            targetDb.PracticeLog.AddRange(practiceLog);
            await targetDb.SaveChangesAsync();
        }
        counts["PracticeLog"] = practiceLog.Count;

        // 17. EarTrainingProgress
        var earTrainingProgress = await sourceDb.EarTrainingProgress.AsNoTracking().ToListAsync();
        if (earTrainingProgress.Count > 0)
        {
            targetDb.EarTrainingProgress.AddRange(earTrainingProgress);
            await targetDb.SaveChangesAsync();
        }
        counts["EarTrainingProgress"] = earTrainingProgress.Count;

        // 18. TuneAliases
        var tuneAliases = await sourceDb.TuneAliases.AsNoTracking().ToListAsync();
        if (tuneAliases.Count > 0)
        {
            targetDb.TuneAliases.AddRange(tuneAliases);
            await targetDb.SaveChangesAsync();
        }
        counts["TuneAliases"] = tuneAliases.Count;

        // 19. TuneSettings
        var tuneSettings = await sourceDb.TuneSettings.AsNoTracking().ToListAsync();
        if (tuneSettings.Count > 0)
        {
            targetDb.TuneSettings.AddRange(tuneSettings);
            await targetDb.SaveChangesAsync();
        }
        counts["TuneSettings"] = tuneSettings.Count;

        // 20. TuneSettingVotes
        var tuneSettingVotes = await sourceDb.TuneSettingVotes.AsNoTracking().ToListAsync();
        if (tuneSettingVotes.Count > 0)
        {
            targetDb.TuneSettingVotes.AddRange(tuneSettingVotes);
            await targetDb.SaveChangesAsync();
        }
        counts["TuneSettingVotes"] = tuneSettingVotes.Count;

        // 21. GroupFeedEvents
        var groupFeedEvents = await sourceDb.GroupFeedEvents.AsNoTracking().ToListAsync();
        if (groupFeedEvents.Count > 0)
        {
            targetDb.GroupFeedEvents.AddRange(groupFeedEvents);
            await targetDb.SaveChangesAsync();
        }
        counts["GroupFeedEvents"] = groupFeedEvents.Count;

        // 22. PointsTransactions
        var pointsTransactions = await sourceDb.PointsTransactions.AsNoTracking().ToListAsync();
        if (pointsTransactions.Count > 0)
        {
            targetDb.PointsTransactions.AddRange(pointsTransactions);
            await targetDb.SaveChangesAsync();
        }
        counts["PointsTransactions"] = pointsTransactions.Count;

        // 23. UserBadges
        var userBadges = await sourceDb.UserBadges.AsNoTracking().ToListAsync();
        if (userBadges.Count > 0)
        {
            targetDb.UserBadges.AddRange(userBadges);
            await targetDb.SaveChangesAsync();
        }
        counts["UserBadges"] = userBadges.Count;

        // 24. Friendships
        var friendships = await sourceDb.Friendships.AsNoTracking().ToListAsync();
        if (friendships.Count > 0)
        {
            targetDb.Friendships.AddRange(friendships);
            await targetDb.SaveChangesAsync();
        }
        counts["Friendships"] = friendships.Count;

        return new OkObjectResult(new
        {
            success = true,
            message = "Migration from Azure SQL to Cosmos DB for NoSQL completed successfully.",
            counts
        });
    }
}
