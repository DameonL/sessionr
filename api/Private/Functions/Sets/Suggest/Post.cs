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

namespace SessionApp.Api.Functions.Sets.Suggest;

public class Post(AppDbContext db, SetAnalyzer analyzer)
{
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
            .ToListAsync();
        await SetSupport.PopulateTuneAndSettingAsync(db, candidates);

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
            .SingleOrDefaultAsync(ut => ut.UserTuneId == lastId && ut.UserId == callerUserId.Value);
        if (last is null)
        {
            return new BadRequestObjectResult("The draft's last tune is not in the user's repertoire.");
        }
        await SetSupport.PopulateTuneAndSettingAsync(db, new[] { last });

        suggestions = candidates
            .Select(ut =>
            {
                var (score, reason) = analyzer.ScoreNextTune(
                    last.Tune.TuneType, last.Tune.Key, ut.Tune.TuneType, ut.Tune.Key, ut.Status,
                    last.Tune.EndingMidi, ut.Tune.StartingMidi);
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

    private static string SortableTitle(string title) =>
        title.StartsWith("The ", StringComparison.OrdinalIgnoreCase) ? title[4..]
        : title.StartsWith("A ", StringComparison.OrdinalIgnoreCase) ? title[2..]
        : title;
}
