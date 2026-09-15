extern alias privateapi;
extern alias publicapi;

using Microsoft.AspNetCore.Mvc;
using SessionApp.Api.Functions;
using SessionApp.Api.IntegrationTests.Infrastructure;
using SessionApp.Api.Models;
using SessionApp.Api.TestSupport;
using PrivateGroupGet = privateapi::SessionApp.Api.Functions.Groups.ByGroupId.Get;
using PublicGroupGet = publicapi::SessionApp.Api.Functions.Groups.ByGroupId.Get;

namespace SessionApp.Api.IntegrationTests.Groups;

/// <summary>
/// The group activity feed is served to members but withheld from the anonymous read, which sits
/// behind a 30-day edge cache. It is the one field on that payload that moves on ordinary member
/// activity — a practice log writes milestones into it — so carrying it would have meant purging
/// every group a user belongs to on the app's most frequent write.
/// </summary>
public class PublicGroupFeedTests(CosmosEmulatorFixture fixture) : CosmosTestBase(fixture)
{
    private async Task<(Models.User Owner, Group Group)> SeedGroupWithFeedAsync()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, "Feed Test Session"));

        // The event belongs to a second member on purpose: the member-facing read passes the caller
        // to BuildGroupFeedAsync as excludeUserId, so your own activity never appears in your feed.
        var other = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, other));

        await SeedAsync(async db =>
        {
            db.GroupFeedEvents.Add(new GroupFeedEvent
            {
                GroupId = group.GroupId,
                UserId = other.UserId,
                EventType = GroupFeedEventType.MemberJoined,
                Payload = "{}",
            });
            await db.SaveChangesAsync();
        });

        return (owner, group);
    }

    [Fact]
    public async Task PublicGroupDetail_WithholdsTheActivityFeed()
    {
        var (_, group) = await SeedGroupWithFeedAsync();

        var result = await InvokeAsync<PublicGroupGet, IActionResult>(fn =>
            fn.GetGroupDetails(TestRequest.Anonymous(), group.GroupId));

        Assert.Empty(Ok<GroupDetailsDto>(result).Feed);
    }

    [Fact]
    public async Task PublicGroupDetail_StillReturnsEverythingElse()
    {
        // The feed is withheld, not the whole payload — a visitor still sees the group.
        var (owner, group) = await SeedGroupWithFeedAsync();

        var result = await InvokeAsync<PublicGroupGet, IActionResult>(fn =>
            fn.GetGroupDetails(TestRequest.Anonymous(), group.GroupId));

        var details = Ok<GroupDetailsDto>(result);
        Assert.Equal("Feed Test Session", details.Name);
        Assert.Contains(details.Members, m => m.UserId == owner.UserId);
    }

    [Fact]
    public async Task PrivateGroupDetail_StillBuildsTheFeedForAMember()
    {
        var (owner, group) = await SeedGroupWithFeedAsync();

        var result = await InvokeAsync<PrivateGroupGet, IActionResult>(fn =>
            fn.GetGroup(TestRequest.For(owner.UserId), group.GroupId));

        Assert.NotEmpty(Ok<GroupDetailsDto>(result).Feed);
    }
}
