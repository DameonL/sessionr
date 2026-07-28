using System;
using System.Linq;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

/// <summary>Shared DTO projection used by both the public (view) and private (mutate/RSVP) session endpoints.</summary>
public static class GroupSessionSupport
{
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
