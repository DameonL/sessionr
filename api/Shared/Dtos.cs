using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;
using SessionApp.Api.Models;

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

public record SaveSetItem(Guid UserTuneId, int Repetitions);

public record SaveSetRequest(string Title, List<SaveSetItem> Items);

public record SaveGroupSetItem(Guid GroupTuneId, int Repetitions);

public record SaveGroupSetRequest(string Title, List<SaveGroupSetItem> Items);

public record GroupSetItemDto(Guid GroupTuneId, int SequenceNumber, int Repetitions, string Title, string TuneType, string Key, string Abc);

public record CreateSessionRequest(string Title, string? Location, DateTime StartsAt, string? Notes, int RepeatWeeks = 1);

public record UpdateSessionRequest(string? Title, string? Location, DateTime? StartsAt, string? Notes, bool? IsCancelled);

public record RsvpRequest(string Status);

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
    List<SessionRsvpMemberDto> Rsvps);

public record SessionRsvpMemberDto(Guid UserId, string DisplayName, string Status);

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
    bool IsPending);

public record CreateGroupRequest(
    string Name,
    string Description,
    string? City = null,
    bool IsPrivate = false,
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
    string? MeetingDescription);

public record CreateGroupScheduleRequest(
    RecurrencePattern RecurrencePattern,
    DayOfWeek? RecurrenceDayOfWeek = null,
    int? RecurrenceWeekOfMonth = null,
    DateTime? StartDate = null,
    string? MeetingTime = null,
    string? MeetingScheduleText = null,
    string? MeetingDescription = null);

public record UpdateGroupScheduleRequest(
    RecurrencePattern RecurrencePattern,
    DayOfWeek? RecurrenceDayOfWeek,
    int? RecurrenceWeekOfMonth,
    DateTime? StartDate,
    string? MeetingTime,
    string? MeetingScheduleText,
    string? MeetingDescription);

public record JoinGroupRequest(string? InviteCode);

public record JoinResultDto(string Status);

public record UpdateGroupInfoRequest(
    string Name,
    string Description,
    string? City,
    bool IsPrivate);

public record ReplaceGroupSchedulesRequest(
    List<CreateGroupScheduleRequest> Schedules);

public record UpdateGroupPrivacyRequest(bool IsPrivate);

public record InviteCodeDto(string InviteCode);

public record GroupMemberDto(Guid UserId, string DisplayName, string Email, string Role);

public record GroupCommonTuneDto(Guid TuneId, string Title, string TuneType, string Key, int MemberCount, int TotalMembersInGroup);

public record GroupActivityDto(string MemberName, string TuneTitle, DateTime PracticedAt);

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
    List<GroupActivityDto> RecentActivity,
    List<GroupUpdateDto> Updates,
    List<GroupMeetingScheduleDto> Schedules);

public record PagedResult<T>(
    List<T> Items,
    int TotalCount,
    int Page,
    int PageSize,
    bool HasMore);
