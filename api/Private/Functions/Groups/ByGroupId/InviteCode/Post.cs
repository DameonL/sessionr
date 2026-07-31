using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.InviteCode;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/groups/{groupId}/invite-code — regenerate a group's invite code.</summary>
    [Function("RegenerateInviteCode")]
    public async Task<IActionResult> RegenerateInviteCode(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/invite-code")] HttpRequest req,
        Guid groupId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var group = await db.Groups.SingleOrDefaultAsync(g => g.GroupId == groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        group.InviteCode = GenerateInviteCode();
        await db.SaveChangesAsync();

        return new OkObjectResult(new { group.GroupId, group.InviteCode });
    }

    private static string GenerateInviteCode()
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var rng = Random.Shared;
        var code = new char[6];
        for (var i = 0; i < code.Length; i++)
        {
            code[i] = chars[rng.Next(chars.Length)];
        }
        return new string(code);
    }
}
