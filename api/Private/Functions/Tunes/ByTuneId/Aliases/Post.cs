using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Tunes.ByTuneId.Aliases;

public class Post(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
    /// <summary>POST /api/tunes/{tuneId}/aliases — add an alternate name to the tune.</summary>
    [Function("CreateTuneAlias")]
    public async Task<IActionResult> CreateTuneAlias(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "tunes/{tuneId:guid}/aliases")] HttpRequest req,
        Guid tuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<CreateAliasRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Name))
        {
            return new BadRequestObjectResult("Name is required.");
        }

        var tune = await db.Tunes.SingleOrDefaultAsync(t => t.TuneId == tuneId);
        if (tune is null)
        {
            return new NotFoundResult();
        }

        var alias = new TuneAlias
        {
            TuneId = tuneId,
            Name = body.Name.Trim()
        };
        db.TuneAliases.Add(alias);
        await db.SaveChangesAsync();

        var purgeResult = await purgeService.PurgeTuneAsync(tuneId);

        return new OkObjectResult(new { Name = alias.Name, cloudflarePurgeResponse = purgeResult.IsSuccess ? null : purgeResult });
    }
}
