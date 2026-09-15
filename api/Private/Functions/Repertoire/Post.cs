using System;
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

namespace SessionApp.Api.Functions.Repertoire;

public class Post(AppDbContext db, ICloudflareCachePurgeService purgeService)
{
    /// <summary>POST /api/repertoire — add a global tune to the user's repertoire.</summary>
    [Function("AddToRepertoire")]
    public async Task<IActionResult> AddToRepertoire(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "repertoire")] HttpRequest req)
    {
        try
        {
            var callerUserId = await req.GetCallerUserIdAsync(db);
            if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
            {
                return new UnauthorizedObjectResult("Authentication credentials are required.");
            }

            AddToRepertoireRequest? body = null;
            try
            {
                body = await req.ReadFromJsonAsync<AddToRepertoireRequest>();
            }
            catch
            {
                return new BadRequestObjectResult("Invalid JSON payload.");
            }

            if (body is null || body.TuneId == Guid.Empty)
            {
                return new BadRequestObjectResult("TuneId is required.");
            }

            var tune = await db.Tunes.SingleOrDefaultAsync(t => t.TuneId == body.TuneId);
            if (tune is null)
            {
                return new NotFoundObjectResult($"Tune {body.TuneId} not found.");
            }

            // NB: AnyAsync/CountAsync translate to an EXISTS/COUNT form the Cosmos
            // provider emits with an unresolved `root` identifier (SC2001), so use a
            // projected FirstOrDefaultAsync (LIMIT 1) existence check instead.
            var existing = await db.UserTunes
                .Where(ut => ut.UserId == callerUserId.Value && ut.TuneId == body.TuneId)
                .Select(ut => (Guid?)ut.UserTuneId)
                .FirstOrDefaultAsync();
            if (existing is not null)
            {
                return new ConflictObjectResult("Tune is already in the repertoire.");
            }

            TuneSetting? selectedSetting = null;
            if (body.TuneSettingId is not null && body.TuneSettingId != Guid.Empty)
            {
                selectedSetting = await db.TuneSettings.SingleOrDefaultAsync(s => s.TuneSettingId == body.TuneSettingId && s.TuneId == body.TuneId);
                if (selectedSetting is null)
                {
                    return new BadRequestObjectResult("TuneSettingId does not belong to the given tune.");
                }
            }
            else
            {
                // No explicit choice: pin the community favourite now rather than leaving the entry
                // unpinned, so later votes by other users don't change the notes under this user.
                selectedSetting = (await db.TuneSettings.AsNoTracking().Where(s => s.TuneId == body.TuneId).ToListAsync())
                    .OrderByDescending(s => s.VoteScore)
                    .ThenBy(s => s.TuneSettingId)
                    .FirstOrDefault();
            }

            var userTune = new UserTune
            {
                UserId = callerUserId.Value,
                TuneId = body.TuneId,
                TuneSettingId = selectedSetting?.TuneSettingId,
                Status = TuneStatus.Learning,
                TargetBpm = Tune.GetDefaultTargetBpm(tune.TuneType),
            };
            db.UserTunes.Add(userTune);
            // Deliberately not purged: RepertoireCount rides on the cached /api/tunes list,
            // and purging that prefix wipes every tune page and search result on an action
            // users take constantly. It is a popularity counter driving a sort, so a stale
            // value is cosmetic and worth the cache hit rate.
            tune.RepertoireCount++;
            await db.SaveChangesAsync();

            userTune.Tune = tune;
            userTune.TuneSetting = selectedSetting;

            await UserCachePurge.PurgeProfileAsync(db, purgeService, callerUserId.Value);

            return new OkObjectResult(RepertoireSupport.ToItemDto(userTune));
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[AddToRepertoire ERROR]\n{ex}");
            return new ObjectResult(new { error = ex.Message, detail = ex.ToString() }) { StatusCode = 500 };
        }
    }
}
