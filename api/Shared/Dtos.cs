using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

// --- Requests ---

public record CreateTuneRequest(string Title, string TuneType, string Key, string Abc);

// --- thesession.org import ---

public record TheSessionSearchResultDto(int TheSessionId, string Name, string Type);

public record ImportRequest(int TheSessionId);

public record TunebookImportRequest(Guid UserId, int MemberId);

public record TunebookImportResultDto(
    int TotalFound,
    int Imported,
    int AddedToRepertoire,
    int AlreadyInRepertoire,
    System.Collections.Generic.List<string> Failures);

public record AddToRepertoireRequest(Guid TuneId, Guid? TuneSettingId = null);

/// <summary>Null fields are left unchanged; an empty CustomAbcText clears the override.</summary>
public record UpdateUserTuneRequest(string? Status, int? TargetBpm, string? CustomAbcText, Guid? TuneSettingId = null);

public record SaveSetItem(Guid UserTuneId, int Repetitions);

public record SaveSetRequest(string Title, List<SaveSetItem> Items);

public record SaveGroupSetItem(Guid GroupTuneId, int Repetitions);

public record SaveGroupSetRequest(Guid UserId, string Title, List<SaveGroupSetItem> Items);

public record GroupSetItemDto(Guid GroupTuneId, int SequenceNumber, int Repetitions, string Title, string TuneType, string Key, string Abc);

public record CreateSessionRequest(Guid UserId, string Title, string? Location, DateTime StartsAt, string? Notes, int RepeatWeeks = 1);

public record UpdateSessionRequest(Guid UserId, string? Title, string? Location, DateTime? StartsAt, string? Notes, bool? IsCancelled);

public record RsvpRequest(Guid UserId, string Status);

public record GroupSessionDto(
    Guid GroupSessionId,
    string Title,
    string? Location,
    DateTime StartsAt,
    string? Notes,
    bool IsCancelled,
    string CreatedByDisplayName,
    int GoingCount,
    int MaybeCount,
    int NotGoingCount,
    string? ViewerRsvpStatus);

public record SaveEarTrainingProgressRequest(int PhraseIndex, int NotesRevealed, bool Completed);

// --- Responses ---

public record TuneDto(Guid TuneId, string Title, string TuneType, string Key);

public record TuneSettingDto(Guid TuneSettingId, string Key, string AbcText, string SubmitterName, int VoteScore, int UserVoteValue);

public record TuneDetailsDto(Guid TuneId, string Title, string TuneType, string Key, System.Collections.Generic.List<string> Aliases, System.Collections.Generic.List<TuneSettingDto> Settings);

public record CreateSettingRequest(string Key, string Abc, string SubmitterName);

public record CreateAliasRequest(string Name);

public record VoteSettingRequest(Guid UserId, int Value);

public record RepertoireItemDto(
    Guid UserTuneId,
    Guid TuneId,
    string Title,
    string TuneType,
    string Key,
    string Status,
    DateTime? LastPracticed,
    int? TargetBpm,
    string Abc,
    bool HasCustomAbc);

public record PracticeQueueItemDto(
    Guid UserTuneId,
    string Title,
    string TuneType,
    string Key,
    string Status,
    DateTime? LastPracticed,
    int? TargetBpm,
    string Abc,
    string Reason);

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
    Guid UserId,
    string? City = null,
    bool IsPrivate = false,
    RecurrencePattern RecurrencePattern = RecurrencePattern.None,
    DayOfWeek? RecurrenceDayOfWeek = null,
    int? RecurrenceWeekOfMonth = null,
    DateTime? StartDate = null,
    string? MeetingTime = null,
    string? MeetingScheduleText = null,
    string? MeetingDescription = null,
    System.Collections.Generic.List<CreateGroupScheduleRequest>? Schedules = null);

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
    Guid UserId,
    RecurrencePattern RecurrencePattern,
    DayOfWeek? RecurrenceDayOfWeek = null,
    int? RecurrenceWeekOfMonth = null,
    DateTime? StartDate = null,
    string? MeetingTime = null,
    string? MeetingScheduleText = null,
    string? MeetingDescription = null);

public record UpdateGroupScheduleRequest(
    Guid UserId,
    RecurrencePattern RecurrencePattern,
    DayOfWeek? RecurrenceDayOfWeek,
    int? RecurrenceWeekOfMonth,
    DateTime? StartDate,
    string? MeetingTime,
    string? MeetingScheduleText,
    string? MeetingDescription);

public record GroupJoinLeaveRequest(Guid UserId);

public record JoinGroupRequest(Guid UserId, string? InviteCode);

public record JoinResultDto(string Status);

public record UpdateGroupInfoRequest(
    Guid UserId,
    string Name,
    string Description,
    string? City,
    bool IsPrivate);

public record ReplaceGroupSchedulesRequest(
    Guid UserId,
    System.Collections.Generic.List<CreateGroupScheduleRequest> Schedules);

public record UpdateGroupPrivacyRequest(Guid UserId, bool IsPrivate);

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

public record AddGroupTuneRequest(Guid UserId, Guid TuneId, Guid? TuneSettingId);

public record UpdateGroupTuneRequest(Guid UserId, Guid? TuneSettingId);

/// <summary>UserId of the acting group owner performing a promote/demote.</summary>
public record GroupRoleActionRequest(Guid UserId);

public record TransferOwnershipRequest(Guid UserId, Guid NewOwnerUserId);

public record GroupUpdateDto(
    Guid GroupUpdateId,
    Guid GroupId,
    string Title,
    string Content,
    Guid CreatedByUserId,
    string CreatedByDisplayName,
    DateTime CreatedAt);

public record CreateGroupUpdateRequest(Guid UserId, string Title, string Content);

public record GroupDetailsDto(
    Guid GroupId,
    string Name,
    string? Description,
    string? City,
    bool IsPrivate,
    string? InviteCode,
    string? ViewerStatus,
    System.Collections.Generic.List<GroupMemberDto> Members,
    System.Collections.Generic.List<GroupMemberDto> PendingMembers,
    System.Collections.Generic.List<GroupTuneDto> MasterTunes,
    System.Collections.Generic.List<GroupCommonTuneDto> CommonTunes,
    System.Collections.Generic.List<GroupActivityDto> RecentActivity,
    System.Collections.Generic.List<GroupUpdateDto> Updates,
    System.Collections.Generic.List<GroupMeetingScheduleDto> Schedules);

public record PagedResult<T>(
    System.Collections.Generic.List<T> Items,
    int TotalCount,
    int Page,
    int PageSize,
    bool HasMore);
