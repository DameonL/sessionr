using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using static SessionApp.Api.Functions.SessionGroupAuthorization;

namespace SessionApp.Api.Functions.Users.Me.IntervalRounds;

public class Post(AppDbContext db, GamificationService gamification, ICloudflareCachePurgeService purgeService)
{
    /// <summary>POST /api/users/me/interval-rounds — record a finished interval-training round for points and badges.</summary>
    [Function("RecordIntervalRound")]
    public async Task<IActionResult> RecordIntervalRound(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "users/me/interval-rounds")] HttpRequest req)
    {
        try
        {
            var callerUserId = await req.GetCallerUserIdAsync(db);
            if (!callerUserId.HasValue || callerUserId.Value == Guid.Empty)
            {
                return Unauthorized("Authentication credentials are required.");
            }

            var body = await req.ReadFromJsonAsync<RecordIntervalRoundRequest>();
            if (body is null || body.RoundId == Guid.Empty)
            {
                return new BadRequestObjectResult("A round id is required.");
            }
            if (body.QuestionCount < GamificationService.IntervalRoundMinQuestions || body.QuestionCount > 100)
            {
                return new BadRequestObjectResult($"QuestionCount must be between {GamificationService.IntervalRoundMinQuestions} and 100.");
            }
            if (body.CorrectCount < 0 || body.CorrectCount > body.QuestionCount)
            {
                return new BadRequestObjectResult("CorrectCount must be between 0 and QuestionCount.");
            }
            if (body.AnswerMode is not ("play" or "name"))
            {
                return new BadRequestObjectResult("AnswerMode must be \"play\" or \"name\".");
            }

            // The cap is per local day, the same day boundary MarkPracticed uses for the streak.
            var localToday = DateTime.UtcNow.AddMinutes(-req.GetTimezoneOffsetMinutes()).Date;
            var result = await gamification.RecordIntervalRoundAsync(
                callerUserId.Value, body.RoundId, body.QuestionCount, body.CorrectCount,
                answeredByPlaying: body.AnswerMode == "play", localToday);

            foreach (var badgeKey in result.NewBadges)
            {
                await GroupFeedSupport.RecordUserMilestoneAsync(db, callerUserId.Value, GroupFeedEventType.BadgeEarned, new BadgeEarnedPayload(badgeKey, GamificationService.BadgeLabel(badgeKey)));
            }

            // A capped round moves no points, but it can still earn a badge.
            if (result.PointsAwarded > 0 || result.NewBadges.Count > 0)
            {
                await purgeService.PurgeGamificationAsync(callerUserId.Value);
            }

            return new OkObjectResult(new RecordIntervalRoundResponseDto(result.PointsAwarded, result.DailyCapReached, result.NewBadges.ToList()));
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[RecordIntervalRound ERROR]\n{ex}");
            return new ObjectResult(new { error = ex.Message, detail = ex.ToString() }) { StatusCode = 500 };
        }
    }
}
