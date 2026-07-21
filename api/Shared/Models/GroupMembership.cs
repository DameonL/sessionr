using System.Text.Json.Serialization;

namespace SessionApp.Api.Models;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum GroupRole
{
    Member,
    Administrator,
    Owner
}

/// <summary>Pending members are awaiting admin approval to join a private group.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum GroupMembershipStatus
{
    Active,
    Pending
}

/// <summary>Join entity for the Group–User many-to-many, carrying the member's role.</summary>
public class GroupMembership
{
    public Guid GroupMembershipId { get; set; } = Guid.CreateVersion7();
    public Guid GroupId { get; set; }
    public Guid UserId { get; set; }
    public GroupRole Role { get; set; } = GroupRole.Member;
    public GroupMembershipStatus Status { get; set; } = GroupMembershipStatus.Active;
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

    public Group Group { get; set; } = null!;
    public User User { get; set; } = null!;
}
