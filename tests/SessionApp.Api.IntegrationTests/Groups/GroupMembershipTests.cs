using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Functions;
using SessionApp.Api.IntegrationTests.Infrastructure;
using SessionApp.Api.Models;
using SessionApp.Api.TestSupport;
using ApprovePost = SessionApp.Api.Functions.Groups.ByGroupId.Members.ByTargetUserId.Approve.Post;
using DemotePost = SessionApp.Api.Functions.Groups.ByGroupId.Members.ByTargetUserId.Demote.Post;
using GroupsPost = SessionApp.Api.Functions.Groups.Post;
using JoinPost = SessionApp.Api.Functions.Groups.ByGroupId.Join.Post;
using PromotePost = SessionApp.Api.Functions.Groups.ByGroupId.Members.ByTargetUserId.Promote.Post;

namespace SessionApp.Api.IntegrationTests.Groups;

/// <summary>
/// Group membership is where authorization actually lives, and on Cosmos every role check is a
/// query against a standalone GroupMembership document — there is no navigation from Group to its
/// members and no unique index stopping a user being joined twice.
/// </summary>
public class GroupMembershipTests(CosmosEmulatorFixture fixture) : CosmosTestBase(fixture)
{
    private static string StatusOf(IActionResult result)
    {
        var value = Assert.IsType<OkObjectResult>(result).Value!;
        return (string)value.GetType().GetProperty("Status")!.GetValue(value)!;
    }

    private Task<GroupMembership?> MembershipAsync(Guid groupId, Guid userId) =>
        Fixture.WithDbAsync(db => db.GroupMemberships.AsNoTracking()
            .SingleOrDefaultAsync(m => m.GroupId == groupId && m.UserId == userId));

    // --- Creating ---

    [Fact]
    public async Task Create_RejectsAnUnauthenticatedCaller()
    {
        var result = await InvokeAsync<GroupsPost, IActionResult>(f =>
            f.CreateGroup(TestRequest.Anonymous(new CreateGroupRequest("Anything", ""))));

        AssertStatus(401, result);
    }

    [Fact]
    public async Task Create_MakesTheCallerTheOwner()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<GroupsPost, IActionResult>(f => f.CreateGroup(TestRequest.For(
            user.UserId, body: new CreateGroupRequest("The Thursday Session", "Weekly", "Dublin"))));

        var payload = Assert.IsType<OkObjectResult>(result).Value!;
        var groupId = (Guid)payload.GetType().GetProperty("GroupId")!.GetValue(payload)!;

        var membership = await MembershipAsync(groupId, user.UserId);
        Assert.NotNull(membership);
        Assert.Equal(GroupRole.Owner, membership!.Role);
        Assert.Equal(GroupMembershipStatus.Active, membership.Status);
    }

    [Fact]
    public async Task Create_APublicGroupHasNoInviteCode()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<GroupsPost, IActionResult>(f => f.CreateGroup(TestRequest.For(
            user.UserId, body: new CreateGroupRequest("Open Session", ""))));

        var payload = Assert.IsType<OkObjectResult>(result).Value!;
        Assert.Null(payload.GetType().GetProperty("InviteCode")!.GetValue(payload));
    }

    [Fact]
    public async Task Create_APrivateGroupGetsAnInviteCode()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<GroupsPost, IActionResult>(f => f.CreateGroup(TestRequest.For(
            user.UserId, body: new CreateGroupRequest("Closed Session", "", IsPrivate: true))));

        var payload = Assert.IsType<OkObjectResult>(result).Value!;
        var code = (string?)payload.GetType().GetProperty("InviteCode")!.GetValue(payload);
        Assert.False(string.IsNullOrWhiteSpace(code));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Create_RequiresAName(string name)
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<GroupsPost, IActionResult>(f => f.CreateGroup(
            TestRequest.For(user.UserId, body: new CreateGroupRequest(name, ""))));

        AssertStatus(400, result);
    }

    [Fact]
    public async Task Create_RejectsAnUnknownTimeZone()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<GroupsPost, IActionResult>(f => f.CreateGroup(TestRequest.For(
            user.UserId, body: new CreateGroupRequest("Somewhere", "", TimeZone: "Mars/Olympus_Mons"))));

        AssertStatus(400, result);
    }

    [Fact]
    public async Task Create_DefaultsToUtcWhenNoTimeZoneIsGiven()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<GroupsPost, IActionResult>(f => f.CreateGroup(
            TestRequest.For(user.UserId, body: new CreateGroupRequest("Default TZ", "", TimeZone: null))));

        var payload = Assert.IsType<OkObjectResult>(result).Value!;
        Assert.Equal("UTC", payload.GetType().GetProperty("TimeZone")!.GetValue(payload));
    }

    // --- Joining ---

    [Fact]
    public async Task Join_APublicGroupIsImmediate()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner));
        var joiner = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<JoinPost, IActionResult>(f =>
            f.JoinGroup(TestRequest.For(joiner.UserId, body: new JoinGroupRequest(null)), group.GroupId));

        Assert.Equal("Active", StatusOf(result));
        var membership = await MembershipAsync(group.GroupId, joiner.UserId);
        Assert.Equal(GroupRole.Member, membership!.Role);
        Assert.Equal(GroupMembershipStatus.Active, membership.Status);
    }

    [Fact]
    public async Task Join_APublicGroupRecordsAFeedEvent()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner));
        var joiner = await SeedAsync(db => db.SeedUserAsync());

        await InvokeAsync<JoinPost, IActionResult>(f =>
            f.JoinGroup(TestRequest.For(joiner.UserId, body: new JoinGroupRequest(null)), group.GroupId));

        var events = await Fixture.WithDbAsync(db => db.GroupFeedEvents.AsNoTracking()
            .Where(e => e.GroupId == group.GroupId && e.UserId == joiner.UserId).ToListAsync());

        Assert.Equal(GroupFeedEventType.MemberJoined, Assert.Single(events).EventType);
    }

    [Fact]
    public async Task Join_APrivateGroupWithoutACodeIsPending()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, isPrivate: true));
        var joiner = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<JoinPost, IActionResult>(f =>
            f.JoinGroup(TestRequest.For(joiner.UserId, body: new JoinGroupRequest(null)), group.GroupId));

        Assert.Equal("Pending", StatusOf(result));
        Assert.Equal(GroupMembershipStatus.Pending, (await MembershipAsync(group.GroupId, joiner.UserId))!.Status);
    }

    [Fact]
    public async Task Join_APrivateGroupWithTheRightCodeIsImmediate()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, isPrivate: true));
        var joiner = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<JoinPost, IActionResult>(f => f.JoinGroup(
            TestRequest.For(joiner.UserId, body: new JoinGroupRequest(group.InviteCode)), group.GroupId));

        Assert.Equal("Active", StatusOf(result));
    }

    [Fact]
    public async Task Join_ThePrivateInviteCodeIsCaseInsensitive()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, isPrivate: true));
        var joiner = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<JoinPost, IActionResult>(f => f.JoinGroup(
            TestRequest.For(joiner.UserId, body: new JoinGroupRequest(group.InviteCode!.ToUpperInvariant())),
            group.GroupId));

        Assert.Equal("Active", StatusOf(result));
    }

    [Fact]
    public async Task Join_APrivateGroupWithAWrongCodeFallsBackToPending()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, isPrivate: true));
        var joiner = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<JoinPost, IActionResult>(f => f.JoinGroup(
            TestRequest.For(joiner.UserId, body: new JoinGroupRequest("WRONGCODE")), group.GroupId));

        Assert.Equal("Pending", StatusOf(result));
    }

    [Fact]
    public async Task Join_RefusesAMemberWhoIsAlreadyIn()
    {
        // There is no unique (GroupId, UserId) index on Cosmos, so this check is the only
        // thing preventing a duplicate membership document.
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner));
        var joiner = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, joiner));

        var result = await InvokeAsync<JoinPost, IActionResult>(f =>
            f.JoinGroup(TestRequest.For(joiner.UserId, body: new JoinGroupRequest(null)), group.GroupId));

        AssertStatus(409, result);

        var memberships = await Fixture.WithDbAsync(db => db.GroupMemberships.AsNoTracking()
            .Where(m => m.GroupId == group.GroupId && m.UserId == joiner.UserId).ToListAsync());
        Assert.Single(memberships);
    }

    [Fact]
    public async Task Join_RefusesARepeatedRequestWhileOneIsPending()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, isPrivate: true));
        var joiner = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, joiner, status: GroupMembershipStatus.Pending));

        var result = await InvokeAsync<JoinPost, IActionResult>(f =>
            f.JoinGroup(TestRequest.For(joiner.UserId, body: new JoinGroupRequest(null)), group.GroupId));

        AssertStatus(409, result);
    }

    [Fact]
    public async Task Join_AnUnknownGroupIsNotFound()
    {
        var joiner = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<JoinPost, IActionResult>(f =>
            f.JoinGroup(TestRequest.For(joiner.UserId, body: new JoinGroupRequest(null)), TestData.NewId()));

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Join_RejectsAnUnauthenticatedCaller()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner));

        var result = await InvokeAsync<JoinPost, IActionResult>(f =>
            f.JoinGroup(TestRequest.Anonymous(new JoinGroupRequest(null)), group.GroupId));

        AssertStatus(401, result);
    }

    // --- Approving ---

    [Fact]
    public async Task Approve_AnOwnerCanAdmitAPendingMember()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, isPrivate: true));
        var applicant = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, applicant, status: GroupMembershipStatus.Pending));

        var result = await InvokeAsync<ApprovePost, IActionResult>(f => f.ApproveGroupJoinRequest(
            TestRequest.For(owner.UserId), group.GroupId, applicant.UserId));

        Assert.IsType<OkObjectResult>(result);
        Assert.Equal(GroupMembershipStatus.Active, (await MembershipAsync(group.GroupId, applicant.UserId))!.Status);
    }

    [Fact]
    public async Task Approve_AnAdministratorCanAlsoAdmit()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, isPrivate: true));
        var admin = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, admin, GroupRole.Administrator));
        var applicant = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, applicant, status: GroupMembershipStatus.Pending));

        var result = await InvokeAsync<ApprovePost, IActionResult>(f => f.ApproveGroupJoinRequest(
            TestRequest.For(admin.UserId), group.GroupId, applicant.UserId));

        Assert.IsType<OkObjectResult>(result);
    }

    [Fact]
    public async Task Approve_AnOrdinaryMemberIsForbidden()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, isPrivate: true));
        var member = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, member));
        var applicant = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, applicant, status: GroupMembershipStatus.Pending));

        var result = await InvokeAsync<ApprovePost, IActionResult>(f => f.ApproveGroupJoinRequest(
            TestRequest.For(member.UserId), group.GroupId, applicant.UserId));

        AssertStatus(403, result);
        Assert.Equal(GroupMembershipStatus.Pending, (await MembershipAsync(group.GroupId, applicant.UserId))!.Status);
    }

    [Fact]
    public async Task Approve_ACompleteOutsiderIsForbidden()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, isPrivate: true));
        var applicant = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, applicant, status: GroupMembershipStatus.Pending));
        var outsider = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<ApprovePost, IActionResult>(f => f.ApproveGroupJoinRequest(
            TestRequest.For(outsider.UserId), group.GroupId, applicant.UserId));

        AssertStatus(403, result);
    }

    [Fact]
    public async Task Approve_AModeratorOverridesTheGroupRoleCheck()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, isPrivate: true));
        var applicant = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, applicant, status: GroupMembershipStatus.Pending));
        var moderator = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<ApprovePost, IActionResult>(f => f.ApproveGroupJoinRequest(
            TestRequest.For(moderator.UserId, moderator: true), group.GroupId, applicant.UserId));

        Assert.IsType<OkObjectResult>(result);
    }

    [Fact]
    public async Task Approve_WithNoPendingRequestIsNotFound()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner));
        var stranger = await SeedAsync(db => db.SeedUserAsync());

        var result = await InvokeAsync<ApprovePost, IActionResult>(f => f.ApproveGroupJoinRequest(
            TestRequest.For(owner.UserId), group.GroupId, stranger.UserId));

        AssertStatus(404, result);
    }

    // --- Promoting / demoting ---

    [Fact]
    public async Task Promote_AnOwnerCanMakeAMemberAnAdministrator()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner));
        var member = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, member));

        var result = await InvokeAsync<PromotePost, IActionResult>(f => f.PromoteMember(
            TestRequest.For(owner.UserId), group.GroupId, member.UserId));

        Assert.IsType<OkObjectResult>(result);
        Assert.Equal(GroupRole.Administrator, (await MembershipAsync(group.GroupId, member.UserId))!.Role);
    }

    [Fact]
    public async Task Promote_AnAdministratorMayNotPromoteOthers()
    {
        // Promotion is Owner-only, unlike approval.
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner));
        var admin = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, admin, GroupRole.Administrator));
        var member = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, member));

        var result = await InvokeAsync<PromotePost, IActionResult>(f => f.PromoteMember(
            TestRequest.For(admin.UserId), group.GroupId, member.UserId));

        AssertStatus(403, result);
        Assert.Equal(GroupRole.Member, (await MembershipAsync(group.GroupId, member.UserId))!.Role);
    }

    [Fact]
    public async Task Promote_APendingApplicantCannotBePromoted()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, isPrivate: true));
        var applicant = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, applicant, status: GroupMembershipStatus.Pending));

        var result = await InvokeAsync<PromotePost, IActionResult>(f => f.PromoteMember(
            TestRequest.For(owner.UserId), group.GroupId, applicant.UserId));

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task Demote_AnOwnerCanReturnAnAdministratorToMember()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner));
        var admin = await SeedAsync(db => db.SeedUserAsync());
        await SeedAsync(db => db.SeedMembershipAsync(group, admin, GroupRole.Administrator));

        var result = await InvokeAsync<DemotePost, IActionResult>(f => f.DemoteMember(
            TestRequest.For(owner.UserId), group.GroupId, admin.UserId));

        Assert.IsType<OkObjectResult>(result);
        Assert.Equal(GroupRole.Member, (await MembershipAsync(group.GroupId, admin.UserId))!.Role);
    }

    [Fact]
    public async Task JoinThenApprove_TheApplicantEndsUpAnActiveMember()
    {
        var owner = await SeedAsync(db => db.SeedUserAsync());
        var group = await SeedAsync(db => db.SeedGroupAsync(owner, isPrivate: true));
        var applicant = await SeedAsync(db => db.SeedUserAsync());

        await InvokeAsync<JoinPost, IActionResult>(f =>
            f.JoinGroup(TestRequest.For(applicant.UserId, body: new JoinGroupRequest(null)), group.GroupId));
        await InvokeAsync<ApprovePost, IActionResult>(f => f.ApproveGroupJoinRequest(
            TestRequest.For(owner.UserId), group.GroupId, applicant.UserId));

        var membership = await MembershipAsync(group.GroupId, applicant.UserId);
        Assert.Equal(GroupMembershipStatus.Active, membership!.Status);
        Assert.Equal(GroupRole.Member, membership.Role);
    }
}
