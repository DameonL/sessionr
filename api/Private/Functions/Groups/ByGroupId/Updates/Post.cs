using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.GroupFeedSupport;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Updates;

public class Post(AppDbContext db)
{
    /// <summary>POST /api/groups/{groupId}/updates — post an announcement/update to the group.</summary>
    [Function("PostGroupUpdate")]
    public async Task<IActionResult> PostGroupUpdate(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "groups/{groupId:guid}/updates")] HttpRequest req,
        Guid groupId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var callerUserId = await req.GetCallerUserIdAsync(db);
        var body = await req.ReadFromJsonAsync<CreateGroupUpdateRequest>();
        if (body is null || string.IsNullOrWhiteSpace(body.Title) || string.IsNullOrWhiteSpace(body.Content))
        {
            return new BadRequestObjectResult("Title and Content are required.");
        }

        var user = await db.Users.AsNoTracking().SingleAsync(u => u.UserId == callerUserId!.Value);

        var update = new GroupUpdate
        {
            GroupId = groupId,
            Title = body.Title.Trim(),
            Content = body.Content.Trim(),
            CreatedByUserId = callerUserId.Value,
            CreatedAt = DateTime.UtcNow
        };
        db.GroupUpdates.Add(update);

        await RecordGroupEventAsync(db, groupId, callerUserId.Value, GroupFeedEventType.AnnouncementPosted,
            new GroupFeedTitlePayload(update.Title));

        await db.SaveChangesAsync();

        return new OkObjectResult(new GroupUpdateDto(
            update.GroupUpdateId,
            update.GroupId,
            update.Title,
            update.Content,
            update.CreatedByUserId,
            user.DisplayName,
            update.CreatedAt
        ));
    }
}
