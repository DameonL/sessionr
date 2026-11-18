using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Moderator.Tunes.MigrateTheSession;

[RequireModerator]
public class Post(TheSessionDataMigrationService migrationService, ILogger<Post> logger)
{
    /// <summary>
    /// POST /api/moderator/tunes/migrate-thesession — runs one resumable batch of the
    /// bulk migration from adactio/TheSession-data's tunes.json.
    /// </summary>
    [Function("MigrateTheSessionTunes")]
    public async Task<IActionResult> MigrateTheSessionTunes(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "moderator/tunes/migrate-thesession")] HttpRequest req)
    {
        if (!req.IsCallerModerator())
        {
            return Forbidden("Moderator access required.");
        }

        MigrateTheSessionRequest? request;
        if (req.ContentLength is null or 0)
        {
            request = new MigrateTheSessionRequest();
        }
        else
        {
            try
            {
                request = await req.ReadFromJsonAsync<MigrateTheSessionRequest>(req.HttpContext.RequestAborted)
                    ?? new MigrateTheSessionRequest();
            }
            catch (JsonException)
            {
                return new BadRequestObjectResult("Invalid migration request payload.");
            }
        }

        if (request.AfterTuneId < 0)
        {
            return new BadRequestObjectResult("AfterTuneId must be >= 0.");
        }

        try
        {
            var result = await migrationService.MigrateBatchAsync(request, req.HttpContext.RequestAborted);
            return new OkObjectResult(result);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "Failed to download thesession.org dataset from GitHub.");
            return new ObjectResult("Could not download thesession.org dataset.")
            {
                StatusCode = StatusCodes.Status502BadGateway
            };
        }
    }
}
