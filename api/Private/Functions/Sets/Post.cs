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
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Sets;

public class Post(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>POST /api/sets — create a set from an ordered list of repertoire tunes.</summary>
    [Function("CreateSet")]
    public async Task<IActionResult> CreateSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "sets")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<SaveSetRequest>();
        var validation = await ValidateSaveRequest(body, callerUserId.Value);
        if (validation is not null)
        {
            return validation;
        }

        var set = new Set { UserId = callerUserId.Value, Title = body!.Title.Trim() };
        db.Sets.Add(set);
        ApplyItems(set, body.Items);
        await db.SaveChangesAsync();

        return await SetSupport.LoadedSetResultAsync(db, analyzer, set.SetId);
    }

    internal async Task<IActionResult?> ValidateSaveRequest(SaveSetRequest? body, Guid userId)
    {
        if (body is null || string.IsNullOrWhiteSpace(body.Title))
        {
            return new BadRequestObjectResult("Title is required.");
        }
        if (body.Items.Count == 0)
        {
            return new BadRequestObjectResult("A set needs at least one tune.");
        }
        var ids = body.Items.Select(i => i.UserTuneId).ToList();
        if (ids.Distinct().Count() != ids.Count)
        {
            return new BadRequestObjectResult("A set cannot contain the same tune twice.");
        }

        var ownedCount = await db.UserTunes
            .CountAsync(ut => ut.UserId == userId && ids.Contains(ut.UserTuneId));
        if (ownedCount != ids.Count)
        {
            return new BadRequestObjectResult("All tunes must come from the user's repertoire.");
        }

        return null;
    }

    internal static void ApplyItems(Set set, List<SaveSetItem> items)
    {
        for (var i = 0; i < items.Count; i++)
        {
            set.Items.Add(new SetItem
            {
                UserTuneId = items[i].UserTuneId,
                SequenceNumber = i + 1,
                Repetitions = Math.Clamp(items[i].Repetitions, 1, 9),
            });
        }
    }
}
