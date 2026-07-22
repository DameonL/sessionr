using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.GroupAuthorization;

namespace SessionApp.Api.Functions;

public class UserFunctions(AppDbContext db)
{
    public record UserLoginResponse(Guid UserId, string DisplayName, string Email);

    /// <summary>GET /api/users/me — resolves (and lazily provisions) the caller's own user record.</summary>
    [Function("GetCurrentUser")]
    public async Task<IActionResult> GetCurrentUser(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "users/me")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var user = await db.Users.AsNoTracking().SingleAsync(u => u.UserId == callerUserId.Value);
        return new OkObjectResult(new UserLoginResponse(user.UserId, user.DisplayName, user.Email));
    }
}
