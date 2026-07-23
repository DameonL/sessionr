using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;

namespace SessionApp.Api.Functions;

/// <summary>Shared points/badge summary projection used by both the "my own" (private) and public-profile gamification endpoints.</summary>
public static class GamificationSupport
{
    public static async Task<GamificationSummaryDto> BuildSummaryAsync(AppDbContext db, Guid userId)
    {
        var totalPoints = await db.PointsTransactions
            .Where(t => t.UserId == userId)
            .SumAsync(t => (int?)t.Points) ?? 0;

        var badges = await db.UserBadges
            .Where(b => b.UserId == userId)
            .OrderBy(b => b.EarnedAt)
            .Select(b => new UserBadgeDto(b.BadgeKey, b.EarnedAt))
            .ToListAsync();

        return new GamificationSummaryDto(totalPoints, badges);
    }
}
