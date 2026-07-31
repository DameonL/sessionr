using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Import.TheSession.Tunebook;

public class Post(AppDbContext db, TheSessionImportService importService, ILogger<Post> logger)
{
    /// <summary>
    /// POST /api/import/thesession/tunebook — bulk-import a member's whole
    /// tunebook by member ID into the library and the user's repertoire.
    /// </summary>
    [Function("ImportTunebook")]
    public async Task<IActionResult> ImportTunebook(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "import/thesession/tunebook")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        const int maxTunes = 200;

        var body = await req.ReadFromJsonAsync<TunebookImportRequest>();
        if (body is null || body.MemberId <= 0)
        {
            return new BadRequestObjectResult("MemberId is required and must be a positive integer.");
        }
        var memberId = body.MemberId.ToString();

        List<TheSessionSearchTune> entries;
        try
        {
            entries = await importService.GetTunebookAsync(memberId, maxTunes);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "thesession.org tunebook listing failed for member {MemberId}", memberId);
            return new ObjectResult("thesession.org is unreachable.") { StatusCode = StatusCodes.Status502BadGateway };
        }

        var result = new TunebookImportResultDto(entries.Count, 0, 0, 0, []);
        var imported = 0;
        var added = 0;
        var already = 0;

        foreach (var entry in entries)
        {
            try
            {
                var detail = await importService.GetTuneDetailAsync(entry.Id);
                if (detail is null)
                {
                    result.Failures.Add($"{entry.Name}: not found on thesession.org");
                    continue;
                }

                var tune = await importService.UpsertTuneFromDetailAsync(detail);
                if (tune is null)
                {
                    result.Failures.Add($"{entry.Name}: no notation found");
                    continue;
                }
                imported++;

                var inRepertoire = await db.UserTunes.AnyAsync(
                    ut => ut.UserId == callerUserId.Value && ut.TuneId == tune.TuneId);
                if (inRepertoire)
                {
                    already++;
                }
                else
                {
                    db.UserTunes.Add(new UserTune
                    {
                        UserId = callerUserId.Value,
                        TuneId = tune.TuneId,
                        Status = TuneStatus.Learning,
                        TargetBpm = Tune.GetDefaultTargetBpm(tune.TuneType),
                    });
                    tune.RepertoireCount++;
                    await db.SaveChangesAsync();

                    added++;
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Tunebook import failed for tune {Id}", entry.Id);
                result.Failures.Add($"{entry.Name}: fetch failed");
            }
        }

        logger.LogInformation(
            "Tunebook import for member {MemberId}: {Found} found, {Imported} imported, {Added} added",
            memberId, entries.Count, imported, added);

        return new OkObjectResult(result with
        {
            Imported = imported,
            AddedToRepertoire = added,
            AlreadyInRepertoire = already,
        });
    }
}
