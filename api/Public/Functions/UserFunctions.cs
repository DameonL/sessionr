using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

public class UserFunctions(AppDbContext db)
{
    public record UserLoginRequest(string Email, string DisplayName);
    public record UserLoginResponse(Guid UserId, string DisplayName, string Email);

    [Function("LoginOrRegisterUser")]
    public async Task<IActionResult> LoginOrRegisterUser(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "users/login")] HttpRequest req)
    {
        var body = await req.ReadFromJsonAsync<UserLoginRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Email))
        {
            return new BadRequestObjectResult("Email is required.");
        }

        var email = body.Email.Trim().ToLowerInvariant();
        var displayName = string.IsNullOrWhiteSpace(body.DisplayName) ? "New Musician" : body.DisplayName.Trim();

        var user = await db.Users.SingleOrDefaultAsync(u => u.Email == email);
        if (user is null)
        {
            // Self-service registration!
            user = new User
            {
                Email = email,
                DisplayName = displayName
            };
            db.Users.Add(user);
            await db.SaveChangesAsync();
        }

        return new OkObjectResult(new UserLoginResponse(user.UserId, user.DisplayName, user.Email));
    }
}
