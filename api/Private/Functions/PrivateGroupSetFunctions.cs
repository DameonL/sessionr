using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.GroupAuthorization;

namespace SessionApp.Api.Functions;

/// <summary>Create/edit/delete a group's set lists. Admin/owner only.</summary>
public class PrivateGroupSetFunctions(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>POST /api/groups/{groupId}/sets — create a set list from the group's master tune list. Admin/owner only.</summary>
    [Function("CreateGroupSet")]
    public async Task<IActionResult> CreateGroupSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/sets")] HttpRequest req,
        Guid groupId)
    {
        var body = await req.ReadFromJsonAsync<SaveGroupSetRequest>();
        var validation = await ValidateSaveRequest(body, groupId);
        if (validation is not null)
        {
            return validation;
        }

        var groupSet = new GroupSet { GroupId = groupId, Title = body!.Title.Trim() };
        db.GroupSets.Add(groupSet);
        ApplyItems(groupSet, body.Items);
        await db.SaveChangesAsync();

        return await GroupSetSupport.LoadedSetResultAsync(db, analyzer, groupSet.GroupSetId, body.UserId);
    }

    /// <summary>PUT /api/groupsets/{groupSetId} — replace the set's title and tune order. Admin/owner only.</summary>
    [Function("UpdateGroupSet")]
    public async Task<IActionResult> UpdateGroupSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "groupsets/{groupSetId:guid}")] HttpRequest req,
        Guid groupSetId)
    {
        var groupSet = await db.GroupSets.Include(gs => gs.Items).SingleOrDefaultAsync(gs => gs.GroupSetId == groupSetId);
        if (groupSet is null)
        {
            return new NotFoundResult();
        }

        var body = await req.ReadFromJsonAsync<SaveGroupSetRequest>();
        var validation = await ValidateSaveRequest(body, groupSet.GroupId);
        if (validation is not null)
        {
            return validation;
        }

        groupSet.Title = body!.Title.Trim();
        db.GroupSetItems.RemoveRange(groupSet.Items);
        groupSet.Items.Clear();
        ApplyItems(groupSet, body.Items);
        await db.SaveChangesAsync();

        return await GroupSetSupport.LoadedSetResultAsync(db, analyzer, groupSetId, body.UserId);
    }

    /// <summary>DELETE /api/groupsets/{groupSetId}?userId= — admin/owner only.</summary>
    [Function("DeleteGroupSet")]
    public async Task<IActionResult> DeleteGroupSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groupsets/{groupSetId:guid}")] HttpRequest req,
        Guid groupSetId)
    {
        Guid.TryParse(req.Query["userId"], out var userId);

        var groupSet = await db.GroupSets.FindAsync(groupSetId);
        if (groupSet is null)
        {
            return new NotFoundResult();
        }

        var actorRole = await db.GetRoleAsync(groupSet.GroupId, userId);
        if (!actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators can delete set lists.");
        }

        db.GroupSets.Remove(groupSet);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }

    private async Task<IActionResult?> ValidateSaveRequest(SaveGroupSetRequest? body, Guid groupId)
    {
        if (body is null || string.IsNullOrWhiteSpace(body.Title))
        {
            return new BadRequestObjectResult("Title is required.");
        }

        var actorRole = await db.GetRoleAsync(groupId, body.UserId);
        if (!actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators can edit set lists.");
        }

        if (body.Items.Count == 0)
        {
            return new BadRequestObjectResult("A set needs at least one tune.");
        }
        var ids = body.Items.Select(i => i.GroupTuneId).ToList();
        if (ids.Distinct().Count() != ids.Count)
        {
            return new BadRequestObjectResult("A set cannot contain the same tune twice.");
        }

        var ownedCount = await db.GroupTunes
            .CountAsync(gt => gt.GroupId == groupId && ids.Contains(gt.GroupTuneId));
        if (ownedCount != ids.Count)
        {
            return new BadRequestObjectResult("All tunes must come from the group's master tune list.");
        }

        return null;
    }

    private static void ApplyItems(GroupSet groupSet, System.Collections.Generic.List<SaveGroupSetItem> items)
    {
        for (var i = 0; i < items.Count; i++)
        {
            groupSet.Items.Add(new GroupSetItem
            {
                GroupTuneId = items[i].GroupTuneId,
                SequenceNumber = i + 1,
                Repetitions = Math.Clamp(items[i].Repetitions, 1, 9),
            });
        }
    }
}
