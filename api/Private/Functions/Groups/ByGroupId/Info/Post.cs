using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.AzureDirectoryAuthorization;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Info;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/groups/{groupId}/info — update basic group metadata (name, description, city, timeZone).</summary>
    [Function("UpdateGroupInfo")]
    public async Task<IActionResult> UpdateGroupInfo(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/info")] HttpRequest req,
        Guid groupId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var body = await req.ReadFromJsonAsync<UpdateGroupInfoRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Name))
        {
            return new BadRequestObjectResult("Group name is required.");
        }

        var timeZone = NormalizeTimeZoneId(body.TimeZone);
        if (body.TimeZone != null && timeZone == null)
        {
            return new BadRequestObjectResult($"Unknown TimeZone ID '{body.TimeZone}'. Use an IANA identifier like 'Europe/Dublin' or 'America/New_York'.");
        }

        var group = await db.Groups.SingleOrDefaultAsync(g => g.GroupId == groupId);
        if (group is null)
        {
            return new NotFoundResult();
        }

        group.Name = body.Name.Trim();
        group.Description = string.IsNullOrWhiteSpace(body.Description) ? null : body.Description.Trim();
        group.City = string.IsNullOrWhiteSpace(body.City) ? null : body.City.Trim();
        if (timeZone != null)
        {
            group.TimeZone = timeZone;
        }

        await db.SaveChangesAsync();
        return new OkObjectResult(new { group.GroupId, group.Name, group.Description, group.City, group.IsPrivate, group.TimeZone });
    }
}
