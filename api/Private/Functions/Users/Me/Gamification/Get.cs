using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using SessionApp.Api.Data;
using SessionApp.Api.Functions;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Users.Me.Gamification;

public class Get(AppDbContext db)
{
    /// <summary>GET /api/users/me/gamification — the caller's own points total and earned badges.</summary>
    [Function("GetMyGamificationSummary")]
    public async Task<IActionResult> GetMyGamificationSummary(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/me/gamification")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        return new OkObjectResult(await GamificationSupport.BuildSummaryAsync(db, callerUserId.Value));
    }
}
