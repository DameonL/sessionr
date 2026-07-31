using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/groups — create a new tune group. The caller becomes Owner.</summary>
    [Function("CreateGroup")]
    public async Task<IActionResult> CreateGroup(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups")] HttpRequest req)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<CreateGroupRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Name))
        {
            return new BadRequestObjectResult("Group name is required.");
        }

        var timeZone = NormalizeTimeZoneId(body.TimeZone);
        if (body.TimeZone != null && timeZone == null)
        {
            return new BadRequestObjectResult($"Unknown TimeZone ID '{body.TimeZone}'. Use an IANA identifier like 'Europe/Dublin' or 'America/New_York'.");
        }

        var group = new Group
        {
            Name = body.Name.Trim(),
            Description = string.IsNullOrWhiteSpace(body.Description) ? null : body.Description.Trim(),
            City = string.IsNullOrWhiteSpace(body.City) ? null : body.City.Trim(),
            IsPrivate = body.IsPrivate,
            InviteCode = body.IsPrivate ? GenerateInviteCode() : null,
            TimeZone = timeZone ?? "UTC"
        };
        db.Groups.Add(group);

        var membership = new GroupMembership
        {
            GroupId = group.GroupId,
            UserId = callerUserId.Value,
            Role = GroupRole.Owner,
            Status = GroupMembershipStatus.Active,
            JoinedAt = DateTime.UtcNow
        };
        db.GroupMemberships.Add(membership);

        await db.SaveChangesAsync();

        return new OkObjectResult(new { group.GroupId, group.Name, group.Description, group.City, group.IsPrivate, group.InviteCode, group.TimeZone });
    }
}
