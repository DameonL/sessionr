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
            session.Title,
            session.Location,
            session.StartsAt,
            session.Notes,
            session.IsCancelled,
            createdByDisplayNameOverride ?? session.CreatedByUser.DisplayName,
            session.Rsvps.Count(r => r.Status == RsvpStatus.Going),
            session.Rsvps.Count(r => r.Status == RsvpStatus.Maybe),
            session.Rsvps.Count(r => r.Status == RsvpStatus.NotGoing),
            session.Rsvps.FirstOrDefault(r => r.UserId == viewerUserId)?.Status.ToString());
}
