using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Privacy;

public class Patch(AppDbContext db)
{
    /// <summary>PATCH /api/groups/{groupId}/privacy — toggle private/public status of a group. Only the Owner can change privacy.</summary>
    [Function("UpdateGroupPrivacy")]
    public async Task<IActionResult> UpdateGroupPrivacy(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "groups/{groupId:guid}/privacy")] HttpRequest req,
        Guid groupId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner);
        if (authResult is not null)
        {
            return authResult;
        }

        var body = await req.ReadFromJsonAsync<UpdateGroupPrivacyRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request body is required.");
        }

        var group = await db.Groups.SingleOrDefaultAsync(g => g.GroupId == groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        group.IsPrivate = body.IsPrivate;
        if (group.IsPrivate && string.IsNullOrEmpty(group.InviteCode))
        {
            group.InviteCode = GenerateInviteCode();
        }

        await db.SaveChangesAsync();
        return new OkObjectResult(new { group.GroupId, group.IsPrivate, group.InviteCode });
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
