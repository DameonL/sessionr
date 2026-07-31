using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions.Import.TheSession.Search;

public class Get(TheSessionImportService importService, ILogger<Get> logger)
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
}
