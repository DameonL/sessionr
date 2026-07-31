using System;

namespace SessionApp.Api.Models;

public enum FriendshipStatus
{
    Pending = 0,
    Accepted = 1
}

public class Friendship
{
    public Guid FriendshipId { get; set; } = Guid.CreateVersion7();
    public Guid RequesterId { get; set; }
    public User Requester { get; set; } = null!;
    public Guid ReceiverId { get; set; }
    public User Receiver { get; set; } = null!;
    public FriendshipStatus Status { get; set; } = FriendshipStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
