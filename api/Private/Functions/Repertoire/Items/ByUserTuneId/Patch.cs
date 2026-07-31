using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Repertoire.Items.ByUserTuneId;

public class Patch(AppDbContext db, ILogger<Patch> logger, GamificationService gamification)
{
    private static readonly TimeSpan TuneLearnedMergeWindow = TimeSpan.FromMinutes(30);
    private const int TuneLearnedDedupeLookback = 20;

    /// <summary>PATCH /api/repertoire/items/{userTuneId} — update status, target BPM, or custom ABC.</summary>
    [Function("UpdateRepertoireItem")]
    public async Task<IActionResult> UpdateRepertoireItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "repertoire/items/{userTuneId:guid}")] HttpRequest req,
        Guid userTuneId)
    {
        var callerUserId = await req.GetCallerUserIdAsync(db);
        if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
        {
            return Unauthorized("Authentication credentials are required.");
        }

        var body = await req.ReadFromJsonAsync<UpdateUserTuneRequest>();
        if (body is null)
        {
            return new BadRequestObjectResult("Request payload is required.");
        }

        var userTune = await db.UserTunes
            .Include(ut => ut.Tune)
            .Include(ut => ut.TuneSetting)
            .SingleOrDefaultAsync(ut => ut.UserTuneId == userTuneId && ut.UserId == callerUserId.Value);

        if (userTune is null)
        {
            return new NotFoundResult();
        }

        var previousStatus = userTune.Status;

        if (body.Status is not null)
        {
            if (!Enum.TryParse<TuneStatus>(body.Status, ignoreCase: true, out var status))
            {
                return new BadRequestObjectResult($"Invalid status '{body.Status}'.");
            }
            userTune.Status = status;
        }

        if (body.TargetBpm is not null)
        {
            if (body.TargetBpm <= 0)
            {
                return new BadRequestObjectResult("TargetBpm must be positive.");
            }
            userTune.TargetBpm = body.TargetBpm.Value;
        }

        if (body.CustomAbcText is not null)
        {
            userTune.CustomAbcText = string.IsNullOrWhiteSpace(body.CustomAbcText)
                ? null
                : body.CustomAbcText.Trim();
        }

        if (body.TuneSettingId is not null)
        {
            var settingBelongs = await db.TuneSettings
                .AnyAsync(s => s.TuneSettingId == body.TuneSettingId && s.TuneId == userTune.TuneId);
            if (!settingBelongs)
            {
                return new BadRequestObjectResult("TuneSettingId does not belong to this tune.");
            }
            userTune.TuneSettingId = body.TuneSettingId;
        }

        await db.SaveChangesAsync();

        if (previousStatus != TuneStatus.Active && userTune.Status == TuneStatus.Active)
        {
            await RecordTuneLearnedFeedEventsAsync(callerUserId.Value, userTune.TuneId);
            await gamification.CheckBadgesAsync(callerUserId.Value);
        }

        var effectiveKey = userTune.TuneSetting != null ? userTune.TuneSetting.Key : userTune.Tune.Key;
        var effectiveAbc = userTune.CustomAbcText ?? (userTune.TuneSetting != null ? userTune.TuneSetting.AbcText : userTune.Tune.MasterAbcText);

        return new OkObjectResult(new RepertoireItemDto(
            userTune.UserTuneId,
            userTune.TuneId,
            userTune.Tune.Title,
            userTune.Tune.TuneType.ToString(),
            effectiveKey,
            userTune.Status.ToString(),
            userTune.LastPracticed,
            userTune.TargetBpm,
            effectiveAbc,
            userTune.CustomAbcText != null));
    }

    private async Task RecordTuneLearnedFeedEventsAsync(Guid userId, Guid tuneId)
    {
        try
        {
            var groupIds = await db.GroupMemberships
                .Where(gm => gm.UserId == userId && gm.Status == GroupMembershipStatus.Active)
                .Select(gm => gm.GroupId)
                .ToListAsync();

            var allEvents = await db.GroupFeedEvents
                .Where(e => groupIds.Contains(e.GroupId) && e.UserId == userId && e.EventType == GroupFeedEventType.TuneLearned)
                .OrderByDescending(e => e.CreatedAt)
                .Take(groupIds.Count * TuneLearnedDedupeLookback)
                .ToListAsync();

            var eventsByGroup = allEvents
                .GroupBy(e => e.GroupId)
                .ToDictionary(g => g.Key, g => g.Take(TuneLearnedDedupeLookback).ToList());

            foreach (var groupId in groupIds)
            {
                var existingEvents = eventsByGroup.GetValueOrDefault(groupId) ?? new List<GroupFeedEvent>();

                var alreadyRecorded = existingEvents.Any(e =>
                    JsonSerializer.Deserialize<TuneLearnedPayload>(e.Payload)?.TuneIds.Contains(tuneId) == true);
                if (alreadyRecorded)
                {
                    continue;
                }

                var mostRecent = existingEvents.FirstOrDefault();
                if (mostRecent != null && DateTime.UtcNow - mostRecent.CreatedAt < TuneLearnedMergeWindow)
                {
                    var payload = JsonSerializer.Deserialize<TuneLearnedPayload>(mostRecent.Payload) ?? new TuneLearnedPayload(new List<Guid>());
                    payload.TuneIds.Add(tuneId);
                    mostRecent.Payload = JsonSerializer.Serialize(payload);
                    mostRecent.CreatedAt = DateTime.UtcNow;
                }
                else
                {
                    db.GroupFeedEvents.Add(new GroupFeedEvent
                    {
                        GroupId = groupId,
                        UserId = userId,
                        EventType = GroupFeedEventType.TuneLearned,
                        Payload = JsonSerializer.Serialize(new TuneLearnedPayload(new List<Guid> { tuneId })),
                    });
                }
            }

            await db.SaveChangesAsync();
        }
        catch (DbUpdateException ex)
        {
            logger.LogWarning(ex, "Failed to record TuneLearned feed event(s) for user {UserId}, tune {TuneId}.", userId, tuneId);
        }
    }
}
