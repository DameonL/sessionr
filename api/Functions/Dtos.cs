namespace SessionApp.Api.Functions;

// --- Requests ---

public record CreateTuneRequest(string Title, string TuneType, string Key, string Abc);

public record AddToRepertoireRequest(int TuneId);

/// <summary>Null fields are left unchanged; an empty CustomAbcText clears the override.</summary>
public record UpdateUserTuneRequest(string? Status, int? TargetBpm, string? CustomAbcText);

public record SaveSetItem(int UserTuneId, int Repetitions);

public record SaveSetRequest(string Title, List<SaveSetItem> Items);

// --- Responses ---

public record TuneDto(int TuneId, string Title, string TuneType, string Key);

public record RepertoireItemDto(
    int UserTuneId,
    int TuneId,
    string Title,
    string TuneType,
    string Key,
    string Status,
    DateTime? LastPracticed,
    int? TargetBpm,
    string Abc,
    bool HasCustomAbc);

public record PracticeQueueItemDto(
    int UserTuneId,
    string Title,
    string TuneType,
    string Key,
    string Status,
    DateTime? LastPracticed,
    int? TargetBpm,
    string Abc,
    string Reason);

public record SuggestNextRequest(List<int> UserTuneIds);

public record NextTuneSuggestionDto(
    int UserTuneId,
    string Title,
    string TuneType,
    string Key,
    string Status,
    int Score,
    string Reason);

public record PracticeDayDto(string Date, int Count);

public record PracticeStatsDto(int CurrentStreakDays, int TotalLast30, List<PracticeDayDto> PerDay);

public record SetItemDto(
    int UserTuneId,
    int SequenceNumber,
    int Repetitions,
    string Title,
    string TuneType,
    string Key,
    string Abc);
