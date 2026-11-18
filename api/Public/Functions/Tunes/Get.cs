using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions.Tunes;

public class Get(TuneLibraryIndex libraryIndex)
{
    /// <summary>GET /api/tunes?search=&amp;type=&amp;key= — search the global tune library.</summary>
    [Function("SearchTunes")]
    public async Task<IActionResult> SearchTunes(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "tunes")] HttpRequest req)
    {
        try
        {
            return await DoSearch(req);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SearchTunes ERROR]\n{ex}");
            return new ObjectResult(new { error = ex.Message, detail = ex.ToString() }) { StatusCode = 500 };
        }
    }

    private async Task<IActionResult> DoSearch(HttpRequest req)
    {
        var search = req.Query["search"].ToString();
        var type = req.Query["type"].ToString();
        var key = req.Query["key"].ToString();
        var sort = req.Query["sort"].ToString();

        int.TryParse(req.Query["page"], out var page);
        int.TryParse(req.Query["pageSize"], out var pageSize);

        var result = await libraryIndex.SearchAsync(
            search,
            type,
            key,
            sort,
            page,
            pageSize,
            req.HttpContext.RequestAborted);

        return new OkObjectResult(result);
    }
}
