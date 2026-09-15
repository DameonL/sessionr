using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions.Import.TheSession;

public class Post(TheSessionImportService importService, ILogger<Post> logger, ICloudflareCachePurgeService purgeService)
{
    /// <summary>
    /// POST /api/import/thesession — import a tune's first setting into the
    /// global library (or return the already-imported tune).
    /// </summary>
    [Function("ImportFromTheSession")]
    public async Task<IActionResult> ImportFromTheSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "import/thesession")] HttpRequest req)
    {
        var body = await req.ReadFromJsonAsync<ImportRequest>();
        if (body is null || body.TheSessionId <= 0)
        {
            return new BadRequestObjectResult("TheSessionId is required.");
        }

        TheSessionTuneDetail? detail;
        try
        {
            detail = await importService.GetTuneDetailAsync(body.TheSessionId);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "thesession.org tune fetch failed for {Id}", body.TheSessionId);
            return new ObjectResult("thesession.org is unreachable.") { StatusCode = StatusCodes.Status502BadGateway };
        }

        var tune = await importService.UpsertTuneFromDetailAsync(detail);
        if (tune is null)
        {
            return new NotFoundObjectResult("Tune or its notation was not found on thesession.org.");
        }

        logger.LogInformation("Imported thesession.org tune {Id} as '{Title}'", body.TheSessionId, tune.Title);

        // A newly imported tune is missing from the cached library list until it is purged, and the
        // upsert may also have rewritten an existing one.
        await purgeService.PurgeAllTunesAsync();

        return new OkObjectResult(new TuneDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key, tune.RepertoireCount, tune.Difficulty));
    }
}
