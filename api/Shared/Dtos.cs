using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;
using SessionApp.Api.Models;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions;

public record CreateTuneRequest(string Title, string TuneType, string Key, string Abc);

public record TheSessionSearchResultDto(int TheSessionId, string Name, string Type);

public record ImportRequest(int TheSessionId);

public record TunebookImportRequest(int MemberId);

public record TunebookImportResultDto(
    int Imported,
    int AddedToRepertoire,
    int AlreadyInRepertoire,
    int SettingsCreated,
    List<string> Failures);

public record AddToRepertoireRequest(Guid TuneId, Guid? TuneSettingId = null);

public record UpdateUserTuneRequest(string? Status, int? TargetBpm, string? CustomAbcText, Guid? TuneSettingId = null);

public record UpdateUserProfileRequest(string? DisplayName, string? Bio, string? Location, string? Instruments, string? Username);

public record PublicUserProfileDto(Guid UserId, string DisplayName, string? Username, string? Bio, string? Location, string? Instruments);

public record UsernameAvailabilityDto(string Username, bool Available, string? Reason);

public record PublicActiveTuneDto(Guid TuneId, string Title, string TuneType, string Key);

public record SaveSetItem(Guid UserTuneId, int Repetitions);

public record SaveSetRequest(string Title, List<SaveSetItem> Items);

public record SaveGroupSetItem(Guid GroupTuneId, int Repetitions);

public record SaveGroupSetRequest(string Title, List<SaveGroupSetItem> Items);

public record GroupSetItemDto(Guid GroupTuneId, int SequenceNumber, int Repetitions, string Title, string TuneType, string Key, string Abc);

/// <summary>Lightweight group-set row for the list view — no ABC payload.</summary>
public record GroupSetItemSummaryDto(Guid GroupTuneId, int SequenceNumber, int Repetitions, string Title, string TuneType, string Key);

/// <summary>Lightweight group set for the list view — no ABC payload, still includes playtime/transition analysis.</summary>
public record GroupSetSummaryDto(Guid GroupSetId, Guid GroupId, string Title, List<GroupSetItemSummaryDto> Items, SetAnalysis Analysis);

public record CreateSessionRequest(string Title, string? Location, DateTime StartsAt, string? Notes, int RepeatWeeks = 1);

public record UpdateSessionRequest(string? Title, string? Location, DateTime? StartsAt, string? Notes, bool? IsCancelled);

public record RsvpRequest(string Status);

public record RsvpScheduleDateRequest(string Date, string Status);

public record RsvpAttendeeDto(Guid UserId, string DisplayName, string Status);

public record GroupSessionDto(
    Guid GroupSessionId,
    Guid GroupId,
    string Title,
    string? Location,
    DateTime StartsAt,
    string? Notes,
    bool IsCancelled,
    Guid CreatedByUserId,
    string CreatedByDisplayName,
    int GoingCount,
    int MaybeCount,
    string? UserRsvp,
    List<RsvpAttendeeDto>? Attendees = null);

public record SaveEarTrainingProgressRequest(int PhraseIndex, int NotesRevealed, bool Completed);

public record TuneDto(Guid TuneId, string Title, string TuneType, string Key);

public record TuneSettingDto(Guid TuneSettingId, string Key, string AbcText, string SubmitterName, int VoteScore, int UserVoteValue);

public record TuneDetailsDto(Guid TuneId, string Title, string TuneType, string Key, List<string> Aliases, List<TuneSettingDto> Settings);

public record CreateSettingRequest(string Key, string Abc, string SubmitterName);

public record CreateAliasRequest(string Name);

public record VoteSettingRequest(int Value);

public record RepertoireItemDto(
    Guid UserTuneId,
    Guid TuneId,
    string Title,
    string TuneType,
    string Key,
    string Status,
    DateTime? LastPracticed,
    int? TargetBpm,
    [property: JsonPropertyName("abcText")] string AbcText,
    bool HasCustomAbc)
{
    [JsonPropertyName("abc")]
    public string Abc => AbcText;
}

/// <summary>Lightweight repertoire row for the scrolling list view — no ABC/settings payload.</summary>
public record RepertoireListItemDto(
    Guid UserTuneId,
    Guid TuneId,
    string Title,
    string TuneType,
    string Key,
    string Status,
    DateTime? LastPracticed,
    int? TargetBpm);

/// <summary>Aggregate repertoire counts for the dashboard — computed via SQL GroupBy, not client-side.</summary>
public record RepertoireStatsDto(
    int TotalCount,
    Dictionary<string, int> ByStatus,
    Dictionary<string, int> ByType,
    int RustyCount);

public record PracticeQueueItemDto(
    Guid UserTuneId,
    string Title,
    string TuneType,
    string Key,
    string Status,
    DateTime? LastPracticed,
    int? TargetBpm,
    [property: JsonPropertyName("abcText")] string AbcText,
    string Reason)
{
    [JsonPropertyName("abc")]
    public string Abc => AbcText;
}

public record SuggestNextRequest(List<Guid> UserTuneIds);

public record NextTuneSuggestionDto(
    Guid UserTuneId,
    string Title,
    string TuneType,
    string Key,
    string Status,
    int Score,
    string Reason);

public record PracticeDayDto(string Date, int Count);

public record PracticeStatsDto(int CurrentStreakDays, int TotalLast30, List<PracticeDayDto> PerDay);

public record MarkPracticedResponseDto(Guid UserTuneId, DateTime? LastPracticed, List<string> NewBadges);

public record UserBadgeDto(string BadgeKey, DateTime EarnedAt);

public record GamificationSummaryDto(int TotalPoints, List<UserBadgeDto> Badges);

public record EarTrainingProgressDto(
    Guid UserTuneId,
    int PhraseIndex,
    int NotesRevealed,
    DateTime? CompletedAt);

public record SetItemDto(
    Guid UserTuneId,
    int SequenceNumber,
    int Repetitions,
    string Title,
    string TuneType,
    string Key,
    string Abc);

/// <summary>Lightweight set row for the list view — no ABC payload.</summary>
public record SetItemSummaryDto(Guid UserTuneId, int SequenceNumber, int Repetitions, string Title, string TuneType, string Key);

/// <summary>Lightweight set for the list view — no ABC payload, still includes playtime/transition analysis.</summary>
public record SetSummaryDto(Guid SetId, string Title, List<SetItemSummaryDto> Items, SetAnalysis Analysis);

public record GroupDto(
    Guid GroupId,
    string Name,
    string? Description,
    string? City,
    int MemberCount,
    bool IsMember,
    bool IsPrivate,
    bool IsPending);

public record GroupSummary(
    Guid GroupId,
    string Name,
    string? Description,
    string? City,
    int MemberCount,
    bool IsMember,
    bool IsPrivate,
    bool IsPending,
    string? TimeZone = "UTC");

public record CreateGroupRequest(
    string Name,
    string Description,
    string? City = null,
    bool IsPrivate = false,
    string? TimeZone = "UTC",
    RecurrencePattern RecurrencePattern = RecurrencePattern.None,
    DayOfWeek? RecurrenceDayOfWeek = null,
    int? RecurrenceWeekOfMonth = null,
    DateTime? StartDate = null,
    string? MeetingTime = null,
    string? MeetingScheduleText = null,
    string? MeetingDescription = null,
    List<CreateGroupScheduleRequest>? Schedules = null);

public record GroupMeetingScheduleDto(
    Guid GroupMeetingScheduleId,
    Guid GroupId,
    RecurrencePattern RecurrencePattern,
    DayOfWeek? RecurrenceDayOfWeek,
    int? RecurrenceWeekOfMonth,
    DateTime? StartDate,
    string? MeetingTime,
    string? MeetingScheduleText,
    string? MeetingDescription,
    List<GroupScheduleExceptionDto> Exceptions,
    string? Name = null);

public record CreateGroupScheduleRequest(
    RecurrencePattern RecurrencePattern,
    DayOfWeek? RecurrenceDayOfWeek = null,
    int? RecurrenceWeekOfMonth = null,
    DateTime? StartDate = null,
    string? MeetingTime = null,
    string? MeetingScheduleText = null,
    string? MeetingDescription = null,
    string? Name = null);

public record UpdateGroupScheduleRequest(
    RecurrencePattern RecurrencePattern,
    DayOfWeek? RecurrenceDayOfWeek,
    int? RecurrenceWeekOfMonth,
    DateTime? StartDate,
    string? MeetingTime,
    string? MeetingScheduleText,
    string? MeetingDescription,
    string? Name = null);

public record JoinGroupRequest(string? InviteCode);

public record JoinResultDto(string Status);

public record UpdateGroupInfoRequest(
    string Name,
    string Description,
    string? City,
    bool IsPrivate,
    string? TimeZone = "UTC");

public record ReplaceGroupSchedulesRequest(
    List<CreateGroupScheduleRequest> Schedules);

public record UpdateGroupPrivacyRequest(bool IsPrivate);

public record InviteCodeDto(string InviteCode);

public record GroupMemberDto(Guid UserId, string DisplayName, string Role);

public record GroupCommonTuneDto(Guid TuneId, string Title, string TuneType, string Key, int MemberCount, int TotalMembersInGroup);

public record GroupFeedEventDto(string MemberName, string EventType, List<string> TuneTitles, DateTime CreatedAt, string? Detail = null);

public record TuneLearnedPayload(List<Guid> TuneIds);

/// <summary>Payload for GroupTuneAdded / GroupTuneRemoved feed events — the tune(s) an admin added to or removed from the group's master list.</summary>
public record GroupTuneChangePayload(List<Guid> TuneIds);

/// <summary>Payload for SessionScheduled / SessionCancelled feed events. WhenText is the session start pre-formatted in the group's timezone; Count is how many sessions the create produced (weekly repeats).</summary>
public record GroupSessionFeedPayload(string Title, string WhenText, int Count = 1);

/// <summary>Payload for AnnouncementPosted / GroupSetCreated feed events — the title of the announcement or set.</summary>
public record GroupFeedTitlePayload(string Title);

/// <summary>Payload for StreakMilestone feed events — the streak length crossed (7/30/100/365).</summary>
public record StreakMilestonePayload(int Days);

/// <summary>Payload for BadgeEarned feed events. Label is the display name resolved at write time (badge labels live in code, not the DB).</summary>
public record BadgeEarnedPayload(string BadgeKey, string Label);

public record GroupScheduleExceptionDto(Guid GroupScheduleExceptionId, Guid GroupMeetingScheduleId, DateTime ExceptionDate);

public record CreateGroupScheduleExceptionRequest(DateTime ExceptionDate);

public record GroupTuneDto(
    Guid GroupTuneId,
    Guid TuneId,
    string Title,
    string TuneType,
    string Key,
    Guid? TuneSettingId,
    string? SettingSubmitterName,
    string AddedByDisplayName);

public record AddGroupTuneRequest(Guid TuneId, Guid? TuneSettingId);

public record UpdateGroupTuneRequest(Guid? TuneSettingId);

public record TransferOwnershipRequest(Guid NewOwnerUserId);

public record GroupUpdateDto(
    Guid GroupUpdateId,
    Guid GroupId,
    string Title,
    string Content,
    Guid CreatedByUserId,
    string CreatedByDisplayName,
    DateTime CreatedAt);

public record CreateGroupUpdateRequest(string Title, string Content);

public record GroupDetailsDto(
    Guid GroupId,
    string Name,
    string? Description,
    string? City,
    bool IsPrivate,
    string? InviteCode,
    string? ViewerStatus,
    List<GroupMemberDto> Members,
    List<GroupMemberDto> PendingMembers,
    List<GroupTuneDto> MasterTunes,
    List<GroupCommonTuneDto> CommonTunes,
    List<GroupFeedEventDto> Feed,
    List<GroupUpdateDto> Updates,
    List<GroupMeetingScheduleDto> Schedules,
    string? TimeZone = "UTC");

public record PagedResult<T>(
    List<T> Items,
    int TotalCount,
    int Page,
    int PageSize,
    bool HasMore);

public record UpcomingMeetingDto(
    Guid GroupId,
    string GroupName,
    Guid? GroupSessionId,
    Guid? GroupMeetingScheduleId,
    string Title,
    string? Location,
    DateTime StartsAt,
    bool IsCancelled,
    string? ViewerRsvpStatus,
    int GoingCount,
    int MaybeCount);

public record DashboardFriendActivityDto(
    Guid ActivityId,
    Guid FriendUserId,
    string FriendDisplayName,
    string? FriendUsername,
    string ActivityType,
    string SummaryText,
    DateTime CreatedAt,
    string? TargetUrl = null);

public record DashboardSummaryDto(
    int CurrentStreakDays,
    List<DashboardActivityFeedItemDto> RecentActivity,
    List<DashboardRustyTuneDto> TopRustyTunes,
    List<DashboardPendingRequestDto> PendingGroupRequests,
    List<DashboardFriendActivityDto>? RecentFriendActivity = null);

public record DashboardActivityFeedItemDto(
    Guid GroupFeedEventId,
    Guid GroupId,
    string GroupName,
    string EventType,
    string SummaryText,
    DateTime CreatedAt);

public record DashboardRustyTuneDto(
    Guid UserTuneId,
    string Title,
    string TuneType,
    DateTime? LastPracticed);

public record DashboardPendingRequestDto(
    Guid GroupId,
    string GroupName,
    int PendingCount);

public record FriendDto(
    Guid UserId,
    string DisplayName,
    string? Username,
    string? Bio,
    string? Location,
    string? Instruments,
    DateTime FriendsSince);

public record FriendRequestDto(
    Guid FriendshipId,
    Guid RequesterId,
    string RequesterDisplayName,
    string? RequesterUsername,
    DateTime RequestedAt);

public record FriendshipStatusDto(
    string Status, // "None" | "PendingSent" | "PendingReceived" | "Accepted"
    Guid? FriendshipId);

