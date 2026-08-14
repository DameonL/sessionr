using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Tunes.RefreshMatchIndex;

[RequireModerator]
public class Post(TuneMatchIndex matchIndex)
{
    /// <summary>
    /// POST /api/moderator/tunes/refresh-match-index — forces this Functions instance's
    /// in-memory tune-identification index (TuneMatchIndex) to rebuild from the database
    /// immediately, instead of waiting for its normal refresh interval. Useful right after
    /// a fingerprint backfill or bulk import.
    ///
    /// The index lives in-process with no shared cache backing it, so on a scaled-out
    /// deployment this only refreshes whichever instance handles this request — other
    /// instances still pick up the change on their own TTL. Lives in the Public app (not
    /// Private, unlike other moderator endpoints) because that's the process that actually
    /// owns the index — MatchTune is a Public, anonymous endpoint.
    /// </summary>
    [Function("RefreshTuneMatchIndex")]
    public async Task<IActionResult> RefreshTuneMatchIndex(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "moderator/tunes/refresh-match-index")] HttpRequest req)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        await matchIndex.ForceRefreshAsync(req.HttpContext.RequestAborted);
        return new OkResult();
    }
}
