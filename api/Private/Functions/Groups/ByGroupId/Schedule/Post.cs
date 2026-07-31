using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Schedule;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/groups/{groupId}/schedule — legacy/convenience endpoint to set meeting schedule text on the group.</summary>
    [Function("CreateGroupSchedule")]
    public async Task<IActionResult> CreateGroupSchedule(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/schedule")] HttpRequest req,
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

        var body = await req.ReadFromJsonAsync<CreateGroupScheduleRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request payload is required.");
        }

        return new OkObjectResult(new { group.GroupId, Message = "Schedule updated." });
    }
}
