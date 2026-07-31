using System.Text.Json.Serialization;

namespace SessionApp.Api.Models;

/// <summary>Rhythmic category of a traditional tune.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum TuneType
{
    Reel,
    Jig,
    SlipJig,
    Hornpipe,
    Polka,
    Slide,
    Waltz,
    March,
    Strathspey,
    Barndance,
    Mazurka,
    Air,
    Other
}

/// <summary>Where a tune sits in the user's practice lifecycle.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum TuneStatus
{
    Wishlist,
    Learning,
    Active,
    Rusty,
    Retired
}

/// <summary>Type of recurring meeting schedule for a group.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum RecurrencePattern
{
    None,
    Weekly,
    Biweekly,
    MonthlyNthDay,
    SpecificDate
}

/// <summary>Kind of system-generated entry in a group's activity feed.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum GroupFeedEventType
{
    TuneLearned,
    MemberJoined,
    GroupTuneAdded,
    GroupTuneRemoved,
    SessionScheduled,
    SessionCancelled,
    AnnouncementPosted,
    GroupSetCreated,
    StreakMilestone,
    BadgeEarned
}

/// <summary>What a gamification points award was for.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum PointsReason
{
    PracticeLogged,
    StreakMilestone
}
