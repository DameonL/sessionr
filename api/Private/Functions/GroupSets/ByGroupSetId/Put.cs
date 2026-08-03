using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.GroupSets.ByGroupSetId;

public class Put(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>PUT /api/groupsets/{groupSetId} — replace the set's title and tune order. Admin/owner only.</summary>
    [Function("UpdateGroupSet")]
    public async Task<IActionResult> UpdateGroupSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "groupsets/{groupSetId:guid}")] HttpRequest req,
        Guid groupSetId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var groupSet = await db.GroupSets.SingleOrDefaultAsync(gs => gs.GroupSetId == groupSetId);
        if (groupSet is null)
        {
            return new NotFoundResult();
        }

        var postHelper = new Groups.ByGroupId.Sets.Post(db, analyzer);
        var (validationResult, body) = await postHelper.ValidateSaveRequest(req, groupSet.GroupId, callerUserId.Value);
        if (validationResult is not null)
        {
            return validationResult;
        }

        groupSet.Title = body!.Title.Trim();
        // Items are separate Cosmos documents; delete the existing ones explicitly, then re-add.
        var existingItems = await db.GroupSetItems.Where(gsi => gsi.GroupSetId == groupSetId).ToListAsync();
        db.GroupSetItems.RemoveRange(existingItems);
        Groups.ByGroupId.Sets.Post.ApplyItems(db, groupSet, body.Items);
        await db.SaveChangesAsync();

        return await GroupSetSupport.LoadedSetResultAsync(db, analyzer, groupSetId, callerUserId.Value);
    }
}
