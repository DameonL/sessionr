using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

/// <summary>Shared DTO projection used by both the public (view) and private (mutate/RSVP) session endpoints.</summary>
public static class GroupSessionSupport
{
    /// <summary>
    /// Populates each session's <c>Rsvps</c> (with each RSVP's <c>User</c>) and <c>CreatedByUser</c> by
    /// id-based stitching, so <see cref="ToDto"/> works without cross-document Includes. RSVPs and Users
    /// are separate Cosmos documents.
    /// </summary>
    public static async Task PopulateAsync(AppDbContext db, params GroupSession[] sessions)
    {
        if (sessions.Length == 0)
        {
            return;
        }

        var sessionIds = sessions.Select(s => s.GroupSessionId).ToList();
        var rsvps = await db.SessionRsvps.AsNoTracking().Where(r => sessionIds.Contains(r.GroupSessionId)).ToListAsync();

        var userIds = sessions.Select(s => s.CreatedByUserId).Concat(rsvps.Select(r => r.UserId)).Distinct().ToList();
        var users = await db.Users.AsNoTracking().Where(u => userIds.Contains(u.UserId)).ToDictionaryAsync(u => u.UserId);

        foreach (var rsvp in rsvps)
        {
            if (users.TryGetValue(rsvp.UserId, out var user))
            {
                rsvp.User = user;
            }
        }

        var rsvpsBySession = rsvps.ToLookup(r => r.GroupSessionId);
        foreach (var session in sessions)
        {
            session.Rsvps = rsvpsBySession[session.GroupSessionId].ToList();
            if (users.TryGetValue(session.CreatedByUserId, out var creator))
            {
                session.CreatedByUser = creator;
            }
        }
    }

    public static GroupSessionDto ToDto(GroupSession session, Guid viewerUserId, string? createdByDisplayNameOverride = null) =>
        new(
            session.GroupSessionId,
            session.GroupId,
            session.Title,
            session.Location,
            session.StartsAt,
            session.Notes,
            session.IsCancelled,
            session.CreatedByUserId,
            createdByDisplayNameOverride ?? session.CreatedByUser?.DisplayName ?? "Member",
            session.Rsvps.Count(r => r.Status == RsvpStatus.Going),
            session.Rsvps.Count(r => r.Status == RsvpStatus.Maybe),
            session.Rsvps.FirstOrDefault(r => r.UserId == viewerUserId)?.Status.ToString(),
            session.Rsvps
                .Where(r => r.User != null)
                .Select(r => new RsvpAttendeeDto(r.UserId, r.User.DisplayName ?? "Member", r.Status.ToString()))
                .ToList());
}
