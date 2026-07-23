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
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;


namespace SessionApp.Api.Functions;

/// <summary>Manage a user's own medley sets, and suggest the next tune while building one.</summary>
public class PrivateSetFunctions(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>GET /api/sets — the user's sets with analysis.</summary>
    [Function("GetSets")]
    public async Task<IActionResult> GetSets(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sets")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        // List view: project only the fields needed for a row + analysis — never reads the
        // (potentially large) ABC columns off disk, unlike the singular GetSet detail view.
        var raw = await db.Sets
            .AsNoTracking()
            .Where(s => s.UserId == callerUserId.Value)
            .OrderBy(s => s.Title)
            .Select(s => new
            {
                s.SetId,
                s.Title,
                Items = s.Items
                    .OrderBy(i => i.SequenceNumber)
                    .Select(i => new
                    {
                        i.UserTuneId,
                        i.SequenceNumber,
                        i.Repetitions,
                        i.UserTune.Tune.Title,
                        i.UserTune.Tune.TuneType,
                        i.UserTune.Tune.Key
                    })
                    .ToList()
            })
            .ToListAsync();

        var sets = raw
            .Select(s => SetSupport.ToSummaryDto(
                s.SetId,
                s.Title,
                s.Items.Select(i => (i.UserTuneId, i.SequenceNumber, i.Repetitions, i.Title, i.TuneType, i.Key)).ToList(),
                analyzer))
            .ToList();

        return new OkObjectResult(sets);
    }

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

        var set = await db.Sets.Include(s => s.Items).SingleOrDefaultAsync(s => s.SetId == setId && s.UserId == callerUserId.Value);
        if (set is null)
        {
            return new NotFoundResult();
        }

        var body = await req.ReadFromJsonAsync<SaveSetRequest>();
        var validation = await ValidateSaveRequest(body, callerUserId.Value);
        if (validation is not null)
        {
            return validation;
        }

        set.Title = body!.Title.Trim();
        db.SetItems.RemoveRange(set.Items);
        set.Items.Clear();
        ApplyItems(set, body.Items);
        await db.SaveChangesAsync();

        return await SetSupport.LoadedSetResultAsync(db, analyzer, setId);
    }

    /// <summary>
    /// POST /api/sets/suggest — given the draft set so far,
    /// rank the rest of the repertoire as candidates for the next tune. An
    /// empty draft returns solid openers instead.
    /// </summary>
    [Function("SuggestNextTune")]
    public async Task<IActionResult> SuggestNextTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "sets/suggest")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<SuggestNextRequest>();
        var draftIds = body?.UserTuneIds ?? [];

        var candidates = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == callerUserId.Value
                && !draftIds.Contains(ut.UserTuneId)
                && ut.Status != TuneStatus.Wishlist
                && ut.Status != TuneStatus.Retired)
            .Include(ut => ut.Tune)
            .ToListAsync();

        List<NextTuneSuggestionDto> suggestions;
        if (draftIds.Count == 0)
        {
            suggestions = candidates
                .OrderByDescending(ut => ut.Status == TuneStatus.Active)
                .ThenBy(ut => SortableTitle(ut.Tune.Title))
                .Take(5)
                .Select(ut => new NextTuneSuggestionDto(
                    ut.UserTuneId, ut.Tune.Title, ut.Tune.TuneType.ToString(), ut.Tune.Key,
                    ut.Status.ToString(), 0,
                    ut.Status == TuneStatus.Active ? "solid opener — gig-ready" : "opener candidate"))
                .ToList();
            return new OkObjectResult(suggestions);
        }

        var lastId = draftIds[^1];
        var last = await db.UserTunes
            .AsNoTracking()
            .Include(ut => ut.Tune)
            .SingleOrDefaultAsync(ut => ut.UserTuneId == lastId && ut.UserId == callerUserId.Value);
        if (last is null)
        {
            return new BadRequestObjectResult("The draft's last tune is not in the user's repertoire.");
        }

        suggestions = candidates
            .Select(ut =>
            {
                var (score, reason) = analyzer.ScoreNextTune(
                    last.Tune.TuneType, last.Tune.Key, ut.Tune.TuneType, ut.Tune.Key, ut.Status);
                return new NextTuneSuggestionDto(
                    ut.UserTuneId, ut.Tune.Title, ut.Tune.TuneType.ToString(), ut.Tune.Key,
                    ut.Status.ToString(), score, reason);
            })
            .OrderByDescending(s => s.Score)
            .ThenBy(s => SortableTitle(s.Title))
            .Take(5)
            .ToList();

        return new OkObjectResult(suggestions);
    }

    /// <summary>Trad convention: ignore a leading "The" or "A" when sorting titles.</summary>
    private static string SortableTitle(string title) =>
        title.StartsWith("The ", StringComparison.OrdinalIgnoreCase) ? title[4..]
        : title.StartsWith("A ", StringComparison.OrdinalIgnoreCase) ? title[2..]
        : title;

    /// <summary>DELETE /api/sets/{setId}</summary>
    [Function("DeleteSet")]
    public async Task<IActionResult> DeleteSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "sets/{setId:guid}")] HttpRequest req,
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

        db.Sets.Remove(set);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }

    private async Task<IActionResult?> ValidateSaveRequest(SaveSetRequest? body, Guid userId)
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

    private static void ApplyItems(Set set, List<SaveSetItem> items)
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
