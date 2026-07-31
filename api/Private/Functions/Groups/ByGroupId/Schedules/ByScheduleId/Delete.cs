using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Groups.ByGroupId.Schedules.ByScheduleId;

public class Delete(AppDbContext db)
{
    /// <summary>DELETE /api/groups/{groupId}/schedules/{scheduleId} — delete a recurring meeting schedule.</summary>
    [Function("DeleteGroupMeetingSchedule")]
    public async Task<IActionResult> DeleteGroupMeetingSchedule(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "groups/{groupId:guid}/schedules/{scheduleId:guid}")] HttpRequest req,
        Guid groupId,
        Guid scheduleId)
    {
        var authResult = await req.AuthorizeGroupRoleAsync(db, groupId, GroupRole.Owner, GroupRole.Administrator);
        if (authResult is not null)
        {
            return authResult;
        }

        var schedule = await db.GroupMeetingSchedules
            .SingleOrDefaultAsync(gms => gms.GroupMeetingScheduleId == scheduleId && gms.GroupId == groupId);
        if (schedule is null)
        {
            return new NotFoundResult();
        }

        db.GroupMeetingSchedules.Remove(schedule);
        await db.SaveChangesAsync();
        return new NoContentResult();
    }
}
