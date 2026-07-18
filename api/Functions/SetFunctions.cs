using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions;

public class SetFunctions(AppDbContext db, SetAnalyzer analyzer)
{
    /// <summary>GET /api/users/{userId}/sets — the user's sets with analysis.</summary>
    [Function("GetSets")]
    public async Task<IActionResult> GetSets(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/{userId:int}/sets")] HttpRequest req,
        int userId)
    {
        var sets = await db.Sets
            .AsNoTracking()
            .Where(s => s.UserId == userId)
            .Include(s => s.Items.OrderBy(i => i.SequenceNumber))
            .ThenInclude(i => i.UserTune)
            .ThenInclude(ut => ut.Tune)
            .OrderBy(s => s.Title)
            .ToListAsync();

        return new OkObjectResult(sets.Select(ToDto).ToList());
    }

    /// <summary>POST /api/users/{userId}/sets — create a set from an ordered list of repertoire tunes.</summary>
    [Function("CreateSet")]
    public async Task<IActionResult> CreateSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "users/{userId:int}/sets")] HttpRequest req,
        int userId)
    {
        var body = await req.ReadFromJsonAsync<SaveSetRequest>();
        var validation = await ValidateSaveRequest(body, userId);
        if (validation is not null)
        {
            return validation;
        }

        var set = new Set { UserId = userId, Title = body!.Title.Trim() };
        db.Sets.Add(set);
        ApplyItems(set, body.Items);
        await db.SaveChangesAsync();

        return await LoadedSetResult(set.SetId);
    }

    /// <summary>GET /api/sets/{setId} — a single set with analysis.</summary>
    [Function("GetSet")]
    public async Task<IActionResult> GetSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sets/{setId:int}")] HttpRequest req,
        int setId)
    {
        return await LoadedSetResult(setId);
    }

    /// <summary>PUT /api/sets/{setId} — replace the set's title and tune order.</summary>
    [Function("UpdateSet")]
    public async Task<IActionResult> UpdateSet(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "sets/{setId:int}")] HttpRequest req,
        int setId)
    {
        var set = await db.Sets.Include(s => s.Items).SingleOrDefaultAsync(s => s.SetId == setId);
        if (set is null)
        {
            return new NotFoundResult();
        }

        var body = await req.ReadFromJsonAsync<SaveSetRequest>();
        var validation = await ValidateSaveRequest(body, set.UserId);
        if (validation is not null)
        {
            return validation;
        }

        set.Title = body!.Title.Trim();
        db.SetItems.RemoveRange(set.Items);
        set.Items.Clear();
        ApplyItems(set, body.Items);
        await db.SaveChangesAsync();

        return await LoadedSetResult(setId);
    }

    /// <summary>
    /// POST /api/users/{userId}/sets/suggest — given the draft set so far,
    /// rank the rest of the repertoire as candidates for the next tune. An
    /// empty draft returns solid openers instead.
    /// </summary>
    [Function("SuggestNextTune")]
    public async Task<IActionResult> SuggestNextTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "users/{userId:int}/sets/suggest")] HttpRequest req,
        int userId)
    {
        var body = await req.ReadFromJsonAsync<SuggestNextRequest>();
        var draftIds = body?.UserTuneIds ?? [];

        var candidates = await db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == userId
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
            .SingleOrDefaultAsync(ut => ut.UserTuneId == lastId && ut.UserId == userId);
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
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "sets/{setId:int}")] HttpRequest req,
        int setId)
    {
        var set = await db.Sets.FindAsync(setId);
        if (set is null)
        {
            return new NotFoundResult();
        }

        db.Sets.Remove(set);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }

    private async Task<IActionResult?> ValidateSaveRequest(SaveSetRequest? body, int userId)
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

    private async Task<IActionResult> LoadedSetResult(int setId)
    {
        var set = await db.Sets
            .AsNoTracking()
            .Include(s => s.Items.OrderBy(i => i.SequenceNumber))
            .ThenInclude(i => i.UserTune)
            .ThenInclude(ut => ut.Tune)
            .SingleOrDefaultAsync(s => s.SetId == setId);

        return set is null ? new NotFoundResult() : new OkObjectResult(ToDto(set));
    }

    private object ToDto(Set set)
    {
        var ordered = set.Items.OrderBy(i => i.SequenceNumber).ToList();
        var analysis = analyzer.Analyze(ordered
            .Select(i => (i.UserTune.Tune.Title, i.UserTune.Tune.TuneType, i.UserTune.Tune.Key, i.Repetitions))
            .ToList());

        return new
        {
            set.SetId,
            set.Title,
            Items = ordered.Select(i => new SetItemDto(
                i.UserTuneId, i.SequenceNumber, i.Repetitions, i.UserTune.Tune.Title,
                i.UserTune.Tune.TuneType.ToString(), i.UserTune.Tune.Key,
                i.UserTune.CustomAbcText ?? i.UserTune.Tune.MasterAbcText)).ToList(),
            Analysis = analysis,
        };
    }
}
