using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions;

/// <summary>
/// Server-side proxy for searching and importing tunes from thesession.org's public
/// JSON API into the shared library (keeps CORS and the external dependency out of the browser).
/// </summary>
public class PublicImportFunctions(TheSessionImportService importService, ILogger<PublicImportFunctions> logger)
{
    /// <summary>GET /api/import/thesession/search?q= — search thesession.org.</summary>
    [Function("SearchTheSession")]
    public async Task<IActionResult> SearchTheSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "import/thesession/search")] HttpRequest req)
    {
        var q = req.Query["q"].ToString();
        if (string.IsNullOrWhiteSpace(q))
        {
            return new BadRequestObjectResult("q is required.");
        }

        System.Collections.Generic.List<TheSessionSearchTune> tunes;
        try
        {
            tunes = await importService.SearchAsync(q);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "thesession.org search failed");
            return new ObjectResult("thesession.org is unreachable.") { StatusCode = StatusCodes.Status502BadGateway };
        }

        var results = tunes
            .Take(10)
            .Select(t => new TheSessionSearchResultDto(t.Id, t.Name, t.Type))
            .ToList();

        return new OkObjectResult(results);
    }

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

        return new OkObjectResult(new TuneDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key));
    }
}
