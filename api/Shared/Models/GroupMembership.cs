namespace SessionApp.Api.Models;

public enum GroupRole
{
    Member,
    Administrator,
    Owner
}

/// <summary>Pending members are awaiting admin approval to join a private group.</summary>
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
