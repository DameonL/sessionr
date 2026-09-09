using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Sets.BySetId;

public class Put(AppDbContext db, SetAnalyzer analyzer, ICloudflareCachePurgeService purgeService)
{
    /// <summary>PUT /api/sets/{setId} — replace the set's title and tune order.</summary>
    [Function("UpdateSet")]
    public async Task<IActionResult> UpdateSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "sets/{setId:guid}")] HttpRequest req,
        Guid setId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var set = await db.Sets.SingleOrDefaultAsync(s => s.SetId == setId && s.UserId == callerUserId.Value);
        if (set is null)
        {
            return new NotFoundResult();
        }

        var body = await req.ReadFromJsonAsync<SaveSetRequest>();
        var postHelper = new Post(db, analyzer, purgeService);
        var validation = await postHelper.ValidateSaveRequest(body, callerUserId.Value);
        if (validation is not null)
        {
            return validation;
        }

        set.Title = body!.Title.Trim();
        // Items are separate Cosmos documents; delete the existing ones explicitly, then re-add.
        var existingItems = await db.SetItems.Where(si => si.SetId == setId).ToListAsync();
        db.SetItems.RemoveRange(existingItems);
        Post.ApplyItems(db, set, body.Items);
        await db.SaveChangesAsync();

        await purgeService.PurgeSetAsync(setId);

        return await SetSupport.LoadedSetResultAsync(db, analyzer, setId);
    }
}
