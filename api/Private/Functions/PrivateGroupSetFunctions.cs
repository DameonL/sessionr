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
    /// <summary>GET /api/groups/{groupId}/sets — the group's set lists with analysis (requires sign-in).</summary>
    [Function("GetGroupSets")]
    public async Task<IActionResult> GetGroupSets(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groups/{groupId:guid}/sets")] HttpRequest req,
        Guid groupId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }
        var userId = callerUserId.Value;

        var viewError = await GroupSetSupport.EnsureCanViewAsync(db, groupId, userId);
        if (viewError is not null)
        {
            return viewError;
        }

        // List view: project only the fields needed for a row + analysis — never reads the
        // (potentially large) ABC columns off disk, unlike the singular GetGroupSet detail view.
        var raw = await db.GroupSets
            .AsNoTracking()
            .Where(gs => gs.GroupId == groupId)
            .OrderBy(gs => gs.Title)
            .Select(gs => new
            {
                gs.GroupSetId,
                gs.GroupId,
                gs.Title,
                Items = gs.Items
                    .OrderBy(i => i.SequenceNumber)
                    .Select(i => new
                    {
                        i.GroupTuneId,
                        i.SequenceNumber,
                        i.Repetitions,
                        i.GroupTune.Tune.Title,
                        i.GroupTune.Tune.TuneType,
                        Key = i.GroupTune.TuneSetting != null ? i.GroupTune.TuneSetting.Key : i.GroupTune.Tune.Key
                    })
                    .ToList()
            })
            .ToListAsync();

        var sets = raw
            .Select(s => GroupSetSupport.ToSummaryDto(
                s.GroupSetId,
                s.GroupId,
                s.Title,
                s.Items.Select(i => (i.GroupTuneId, i.SequenceNumber, i.Repetitions, i.Title, i.TuneType, i.Key)).ToList(),
                analyzer))
            .ToList();

        return new OkObjectResult(sets);
    }

    /// <summary>GET /api/groupsets/{groupSetId} — a single group set with analysis (requires sign-in).</summary>
    [Function("GetGroupSet")]
    public async Task<IActionResult> GetGroupSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "groupsets/{groupSetId:guid}")] HttpRequest req,
        Guid groupSetId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }
        return await GroupSetSupport.LoadedSetResultAsync(db, analyzer, groupSetId, callerUserId.Value);
    }

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
        ApplyItems(groupSet, body.Items);
        await db.SaveChangesAsync();

        return await GroupSetSupport.LoadedSetResultAsync(db, analyzer, groupSet.GroupSetId, callerUserId.Value);
    }

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

        var groupSet = await db.GroupSets.Include(gs => gs.Items).SingleOrDefaultAsync(gs => gs.GroupSetId == groupSetId);
        if (groupSet is null)
        {
            return new NotFoundResult();
        }

        var (validationResult, body) = await ValidateSaveRequest(req, groupSet.GroupId, callerUserId.Value);
        if (validationResult is not null)
        {
            return validationResult;
        }

        groupSet.Title = body!.Title.Trim();
        db.GroupSetItems.RemoveRange(groupSet.Items);
        groupSet.Items.Clear();
        ApplyItems(groupSet, body.Items);
        await db.SaveChangesAsync();

        return await GroupSetSupport.LoadedSetResultAsync(db, analyzer, groupSetId, callerUserId.Value);
    }

    /// <summary>DELETE /api/groupsets/{groupSetId} — admin/owner only.</summary>
    [Function("DeleteGroupSet")]
    public async Task<IActionResult> DeleteGroupSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groupsets/{groupSetId:guid}")] HttpRequest req,
        Guid groupSetId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var groupSet = await db.GroupSets.FindAsync(groupSetId);
        if (groupSet is null)
        {
            return new NotFoundResult();
        }

        var actorRole = await db.GetRoleAsync(groupSet.GroupId, callerUserId.Value);
        if (!actorRole.IsAdminOrOwner())
        {
            return Forbidden("Only group administrators can delete set lists.");
        }

        db.GroupSets.Remove(groupSet);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }

    private async Task<(IActionResult? Result, SaveGroupSetRequest? Body)> ValidateSaveRequest(HttpRequest req, Guid groupId, Guid callerUserId)
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
            .CountAsync(gt => gt.GroupId == groupId && ids.Contains(gt.GroupTuneId));
        if (ownedCount != ids.Count)
        {
            return (new BadRequestObjectResult("All tunes must come from the group's master tune list."), body);
        }

        return (null, body);
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
