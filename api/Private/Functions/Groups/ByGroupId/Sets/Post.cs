using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.GroupFeedSupport;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Sets;

public class Post(AppDbContext db, SetAnalyzer analyzer, ICloudflareCachePurgeService purgeService)
{
    /// <summary>POST /api/groups/{groupId}/sets — create a set list from the group's master tune list. Admin/owner only.</summary>
    [Function("CreateGroupSet")]
    public async Task<IActionResult> CreateGroupSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/sets")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var (validationResult, body) = await ValidateSaveRequest(req, groupId, callerUserId.Value);
        if (validationResult is not null)
        {
            return validationResult;
        }

        var groupSet = new GroupSet { GroupId = groupId, Title = body!.Title.Trim() };
        db.GroupSets.Add(groupSet);
        ApplyItems(db, groupSet, body.Items);
        await db.SaveChangesAsync();

        await RecordGroupEventAsync(db, groupId, callerUserId.Value, GroupFeedEventType.GroupSetCreated,
            new GroupFeedTitlePayload(groupSet.Title));

        // Anyone not signed in reads the group's sets through the public API, where the list — and
        // the 404 for a set id that did not exist yet — is cached at the edge for a month.
        await purgeService.PurgeGroupSetAsync(groupSet.GroupSetId, groupId);

        return await GroupSetSupport.LoadedSetResultAsync(db, analyzer, groupSet.GroupSetId, callerUserId.Value);
    }

    internal async Task<(IActionResult? Result, SaveGroupSetRequest? Body)> ValidateSaveRequest(HttpRequest req, Guid groupId, Guid callerUserId)
    {
        var body = await req.ReadFromJsonAsync<SaveGroupSetRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Title))
        {
            return (new BadRequestObjectResult("Title is required."), null);
        }

        var actorRole = await db.GetRoleAsync(groupId, callerUserId);
        if (!actorRole.IsAdminOrOwner())
        {
            return (Forbidden("Only group administrators can edit set lists."), body);
        }

        if (body.Items.Count == 0)
        {
            return (new BadRequestObjectResult("A set needs at least one tune."), body);
        }
        var ids = body.Items.Select(i => i.GroupTuneId).ToList();
        if (ids.Distinct().Count() != ids.Count)
        {
            return (new BadRequestObjectResult("A set cannot contain the same tune twice."), body);
        }

        var ownedCount = await db.GroupTunes
            .Where(gt => gt.GroupId == groupId && ids.Contains(gt.GroupTuneId))
            .Select(gt => gt.GroupTuneId)
            .CosmosCountAsync();
        if (ownedCount != ids.Count)
        {
            return (new BadRequestObjectResult("All tunes must come from the group's master tune list."), body);
        }

        return (null, body);
    }

    // Adds items through the GroupSetItem DbSet keyed by GroupSetId rather than the groupSet.Items
    // navigation, which Cosmos doesn't persist across documents.
    internal static void ApplyItems(AppDbContext db, GroupSet groupSet, List<SaveGroupSetItem> items)
    {
        for (var i = 0; i < items.Count; i++)
        {
            db.GroupSetItems.Add(new GroupSetItem
            {
                GroupSetId = groupSet.GroupSetId,
                GroupTuneId = items[i].GroupTuneId,
                SequenceNumber = i + 1,
                Repetitions = Math.Clamp(items[i].Repetitions, 1, 9),
            });
        }
    }
}
