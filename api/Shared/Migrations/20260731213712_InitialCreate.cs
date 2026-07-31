using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SessionApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Groups",
                columns: table => new
                {
                    GroupId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Description = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    City = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    IsPrivate = table.Column<bool>(type: "bit", nullable: false),
                    InviteCode = table.Column<string>(type: "nvarchar(450)", nullable: true),
                    TimeZone = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    IsReviewed = table.Column<bool>(type: "bit", nullable: false),
                    ReviewedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ReviewedBy = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Groups", x => x.GroupId);
                });

            migrationBuilder.CreateTable(
                name: "Tunes",
                columns: table => new
                {
                    TuneId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TheSessionId = table.Column<int>(type: "int", nullable: true),
                    Title = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    TuneType = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Key = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    MasterAbcText = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    IsReviewed = table.Column<bool>(type: "bit", nullable: false),
                    ReviewedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ReviewedBy = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    RepertoireCount = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tunes", x => x.TuneId);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Username = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: true),
                    Email = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    Bio = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Location = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Instruments = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CurrentStreak = table.Column<int>(type: "int", nullable: false),
                    StreakAnchorDate = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.UserId);
                });

            migrationBuilder.CreateTable(
                name: "GroupMeetingSchedules",
                columns: table => new
                {
                    GroupMeetingScheduleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    RecurrencePattern = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    RecurrenceDayOfWeek = table.Column<int>(type: "int", nullable: true),
                    RecurrenceWeekOfMonth = table.Column<int>(type: "int", nullable: true),
                    StartDate = table.Column<DateTime>(type: "datetime2", nullable: true),
                    MeetingTime = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MeetingScheduleText = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    MeetingDescription = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupMeetingSchedules", x => x.GroupMeetingScheduleId);
                    table.ForeignKey(
                        name: "FK_GroupMeetingSchedules_Groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "Groups",
                        principalColumn: "GroupId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GroupSets",
                columns: table => new
                {
                    GroupSetId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupSets", x => x.GroupSetId);
                    table.ForeignKey(
                        name: "FK_GroupSets_Groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "Groups",
                        principalColumn: "GroupId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TuneAliases",
                columns: table => new
                {
                    TuneAliasId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TuneId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TuneAliases", x => x.TuneAliasId);
                    table.ForeignKey(
                        name: "FK_TuneAliases_Tunes_TuneId",
                        column: x => x.TuneId,
                        principalTable: "Tunes",
                        principalColumn: "TuneId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TuneSettings",
                columns: table => new
                {
                    TuneSettingId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TuneId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Key = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    AbcText = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SubmitterName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    VoteScore = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TuneSettings", x => x.TuneSettingId);
                    table.ForeignKey(
                        name: "FK_TuneSettings_Tunes_TuneId",
                        column: x => x.TuneId,
                        principalTable: "Tunes",
                        principalColumn: "TuneId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Friendships",
                columns: table => new
                {
                    FriendshipId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RequesterId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ReceiverId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Friendships", x => x.FriendshipId);
                    table.ForeignKey(
                        name: "FK_Friendships_Users_ReceiverId",
                        column: x => x.ReceiverId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Friendships_Users_RequesterId",
                        column: x => x.RequesterId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GroupFeedEvents",
                columns: table => new
                {
                    GroupFeedEventId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    EventType = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Payload = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupFeedEvents", x => x.GroupFeedEventId);
                    table.ForeignKey(
                        name: "FK_GroupFeedEvents_Groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "Groups",
                        principalColumn: "GroupId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupFeedEvents_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GroupMemberships",
                columns: table => new
                {
                    GroupMembershipId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Role = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    JoinedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupMemberships", x => x.GroupMembershipId);
                    table.ForeignKey(
                        name: "FK_GroupMemberships_Groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "Groups",
                        principalColumn: "GroupId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupMemberships_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GroupSessions",
                columns: table => new
                {
                    GroupSessionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Location = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    StartsAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    IsCancelled = table.Column<bool>(type: "bit", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupSessions", x => x.GroupSessionId);
                    table.ForeignKey(
                        name: "FK_GroupSessions_Groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "Groups",
                        principalColumn: "GroupId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupSessions_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GroupUpdates",
                columns: table => new
                {
                    GroupUpdateId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Content = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupUpdates", x => x.GroupUpdateId);
                    table.ForeignKey(
                        name: "FK_GroupUpdates_Groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "Groups",
                        principalColumn: "GroupId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupUpdates_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PointsTransactions",
                columns: table => new
                {
                    PointsTransactionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Points = table.Column<int>(type: "int", nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                    SourceId = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PointsTransactions", x => x.PointsTransactionId);
                    table.ForeignKey(
                        name: "FK_PointsTransactions_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Sets",
                columns: table => new
                {
                    SetId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Sets", x => x.SetId);
                    table.ForeignKey(
                        name: "FK_Sets_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserBadges",
                columns: table => new
                {
                    UserBadgeId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    BadgeKey = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                    EarnedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserBadges", x => x.UserBadgeId);
                    table.ForeignKey(
                        name: "FK_UserBadges_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GroupScheduleExceptions",
                columns: table => new
                {
                    GroupScheduleExceptionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupMeetingScheduleId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ExceptionDate = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupScheduleExceptions", x => x.GroupScheduleExceptionId);
                    table.ForeignKey(
                        name: "FK_GroupScheduleExceptions_GroupMeetingSchedules_GroupMeetingScheduleId",
                        column: x => x.GroupMeetingScheduleId,
                        principalTable: "GroupMeetingSchedules",
                        principalColumn: "GroupMeetingScheduleId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupScheduleExceptions_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GroupTunes",
                columns: table => new
                {
                    GroupTuneId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TuneId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    AddedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    TuneSettingId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupTunes", x => x.GroupTuneId);
                    table.ForeignKey(
                        name: "FK_GroupTunes_Groups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "Groups",
                        principalColumn: "GroupId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupTunes_TuneSettings_TuneSettingId",
                        column: x => x.TuneSettingId,
                        principalTable: "TuneSettings",
                        principalColumn: "TuneSettingId",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GroupTunes_Tunes_TuneId",
                        column: x => x.TuneId,
                        principalTable: "Tunes",
                        principalColumn: "TuneId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupTunes_Users_AddedByUserId",
                        column: x => x.AddedByUserId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TuneSettingVotes",
                columns: table => new
                {
                    TuneSettingVoteId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TuneSettingId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Value = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TuneSettingVotes", x => x.TuneSettingVoteId);
                    table.ForeignKey(
                        name: "FK_TuneSettingVotes_TuneSettings_TuneSettingId",
                        column: x => x.TuneSettingId,
                        principalTable: "TuneSettings",
                        principalColumn: "TuneSettingId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TuneSettingVotes_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UserTunes",
                columns: table => new
                {
                    UserTuneId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    TuneId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    CustomAbcText = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    LastPracticed = table.Column<DateTime>(type: "datetime2", nullable: true),
                    TargetBpm = table.Column<int>(type: "int", nullable: true),
                    TuneSettingId = table.Column<Guid>(type: "uniqueidentifier", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserTunes", x => x.UserTuneId);
                    table.ForeignKey(
                        name: "FK_UserTunes_TuneSettings_TuneSettingId",
                        column: x => x.TuneSettingId,
                        principalTable: "TuneSettings",
                        principalColumn: "TuneSettingId",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_UserTunes_Tunes_TuneId",
                        column: x => x.TuneId,
                        principalTable: "Tunes",
                        principalColumn: "TuneId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserTunes_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SessionRsvps",
                columns: table => new
                {
                    SessionRsvpId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupSessionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    RespondedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SessionRsvps", x => x.SessionRsvpId);
                    table.ForeignKey(
                        name: "FK_SessionRsvps_GroupSessions_GroupSessionId",
                        column: x => x.GroupSessionId,
                        principalTable: "GroupSessions",
                        principalColumn: "GroupSessionId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SessionRsvps_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "UserId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GroupSetItems",
                columns: table => new
                {
                    GroupSetItemId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupSetId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupTuneId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SequenceNumber = table.Column<int>(type: "int", nullable: false),
                    Repetitions = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupSetItems", x => x.GroupSetItemId);
                    table.ForeignKey(
                        name: "FK_GroupSetItems_GroupSets_GroupSetId",
                        column: x => x.GroupSetId,
                        principalTable: "GroupSets",
                        principalColumn: "GroupSetId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupSetItems_GroupTunes_GroupTuneId",
                        column: x => x.GroupTuneId,
                        principalTable: "GroupTunes",
                        principalColumn: "GroupTuneId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "EarTrainingProgress",
                columns: table => new
                {
                    EarTrainingProgressId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserTuneId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PhraseIndex = table.Column<int>(type: "int", nullable: false),
                    NotesRevealed = table.Column<int>(type: "int", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EarTrainingProgress", x => x.EarTrainingProgressId);
                    table.ForeignKey(
                        name: "FK_EarTrainingProgress_UserTunes_UserTuneId",
                        column: x => x.UserTuneId,
                        principalTable: "UserTunes",
                        principalColumn: "UserTuneId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PracticeLog",
                columns: table => new
                {
                    PracticeLogId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserTuneId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    PracticedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PracticeLog", x => x.PracticeLogId);
                    table.ForeignKey(
                        name: "FK_PracticeLog_UserTunes_UserTuneId",
                        column: x => x.UserTuneId,
                        principalTable: "UserTunes",
                        principalColumn: "UserTuneId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SetItems",
                columns: table => new
                {
                    SetItemId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SetId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserTuneId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    SequenceNumber = table.Column<int>(type: "int", nullable: false),
                    Repetitions = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SetItems", x => x.SetItemId);
                    table.ForeignKey(
                        name: "FK_SetItems_Sets_SetId",
                        column: x => x.SetId,
                        principalTable: "Sets",
                        principalColumn: "SetId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SetItems_UserTunes_UserTuneId",
                        column: x => x.UserTuneId,
                        principalTable: "UserTunes",
                        principalColumn: "UserTuneId",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EarTrainingProgress_UserTuneId",
                table: "EarTrainingProgress",
                column: "UserTuneId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Friendships_ReceiverId_Status",
                table: "Friendships",
                columns: new[] { "ReceiverId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Friendships_RequesterId_ReceiverId",
                table: "Friendships",
                columns: new[] { "RequesterId", "ReceiverId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Friendships_RequesterId_Status",
                table: "Friendships",
                columns: new[] { "RequesterId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_GroupFeedEvents_GroupId_CreatedAt",
                table: "GroupFeedEvents",
                columns: new[] { "GroupId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GroupFeedEvents_GroupId_UserId",
                table: "GroupFeedEvents",
                columns: new[] { "GroupId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "IX_GroupFeedEvents_UserId",
                table: "GroupFeedEvents",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupMeetingSchedules_GroupId",
                table: "GroupMeetingSchedules",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupMemberships_GroupId_UserId",
                table: "GroupMemberships",
                columns: new[] { "GroupId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GroupMemberships_UserId",
                table: "GroupMemberships",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_Groups_InviteCode",
                table: "Groups",
                column: "InviteCode",
                unique: true,
                filter: "[InviteCode] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_GroupScheduleExceptions_CreatedByUserId",
                table: "GroupScheduleExceptions",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupScheduleExceptions_GroupMeetingScheduleId_ExceptionDate",
                table: "GroupScheduleExceptions",
                columns: new[] { "GroupMeetingScheduleId", "ExceptionDate" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GroupSessions_CreatedByUserId",
                table: "GroupSessions",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupSessions_GroupId_StartsAt",
                table: "GroupSessions",
                columns: new[] { "GroupId", "StartsAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GroupSetItems_GroupSetId_SequenceNumber",
                table: "GroupSetItems",
                columns: new[] { "GroupSetId", "SequenceNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GroupSetItems_GroupTuneId",
                table: "GroupSetItems",
                column: "GroupTuneId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupSets_GroupId",
                table: "GroupSets",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupTunes_AddedByUserId",
                table: "GroupTunes",
                column: "AddedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupTunes_GroupId_TuneId",
                table: "GroupTunes",
                columns: new[] { "GroupId", "TuneId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GroupTunes_TuneId",
                table: "GroupTunes",
                column: "TuneId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupTunes_TuneSettingId",
                table: "GroupTunes",
                column: "TuneSettingId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupUpdates_CreatedAt",
                table: "GroupUpdates",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_GroupUpdates_CreatedByUserId",
                table: "GroupUpdates",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupUpdates_GroupId",
                table: "GroupUpdates",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_PointsTransactions_UserId_Reason_SourceId",
                table: "PointsTransactions",
                columns: new[] { "UserId", "Reason", "SourceId" },
                unique: true,
                filter: "[SourceId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PracticeLog_PracticedAt",
                table: "PracticeLog",
                column: "PracticedAt");

            migrationBuilder.CreateIndex(
                name: "IX_PracticeLog_UserTuneId",
                table: "PracticeLog",
                column: "UserTuneId");

            migrationBuilder.CreateIndex(
                name: "IX_SessionRsvps_GroupSessionId_UserId",
                table: "SessionRsvps",
                columns: new[] { "GroupSessionId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SessionRsvps_UserId",
                table: "SessionRsvps",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_SetItems_SetId_SequenceNumber",
                table: "SetItems",
                columns: new[] { "SetId", "SequenceNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SetItems_UserTuneId",
                table: "SetItems",
                column: "UserTuneId");

            migrationBuilder.CreateIndex(
                name: "IX_Sets_UserId",
                table: "Sets",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_TuneAliases_TuneId",
                table: "TuneAliases",
                column: "TuneId");

            migrationBuilder.CreateIndex(
                name: "IX_Tunes_Title",
                table: "Tunes",
                column: "Title");

            migrationBuilder.CreateIndex(
                name: "IX_TuneSettings_TuneId",
                table: "TuneSettings",
                column: "TuneId");

            migrationBuilder.CreateIndex(
                name: "IX_TuneSettingVotes_TuneSettingId_UserId",
                table: "TuneSettingVotes",
                columns: new[] { "TuneSettingId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TuneSettingVotes_UserId",
                table: "TuneSettingVotes",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_UserBadges_UserId_BadgeKey",
                table: "UserBadges",
                columns: new[] { "UserId", "BadgeKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_Email",
                table: "Users",
                column: "Email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_Username",
                table: "Users",
                column: "Username",
                unique: true,
                filter: "[Username] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_UserTunes_TuneId",
                table: "UserTunes",
                column: "TuneId");

            migrationBuilder.CreateIndex(
                name: "IX_UserTunes_TuneSettingId",
                table: "UserTunes",
                column: "TuneSettingId");

            migrationBuilder.CreateIndex(
                name: "IX_UserTunes_UserId_LastPracticed",
                table: "UserTunes",
                columns: new[] { "UserId", "LastPracticed" });

            migrationBuilder.CreateIndex(
                name: "IX_UserTunes_UserId_Status",
                table: "UserTunes",
                columns: new[] { "UserId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_UserTunes_UserId_TuneId",
                table: "UserTunes",
                columns: new[] { "UserId", "TuneId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EarTrainingProgress");

            migrationBuilder.DropTable(
                name: "Friendships");

            migrationBuilder.DropTable(
                name: "GroupFeedEvents");

            migrationBuilder.DropTable(
                name: "GroupMemberships");

            migrationBuilder.DropTable(
                name: "GroupScheduleExceptions");

            migrationBuilder.DropTable(
                name: "GroupSetItems");

            migrationBuilder.DropTable(
                name: "GroupUpdates");

            migrationBuilder.DropTable(
                name: "PointsTransactions");

            migrationBuilder.DropTable(
                name: "PracticeLog");

            migrationBuilder.DropTable(
                name: "SessionRsvps");

            migrationBuilder.DropTable(
                name: "SetItems");

            migrationBuilder.DropTable(
                name: "TuneAliases");

            migrationBuilder.DropTable(
                name: "TuneSettingVotes");

            migrationBuilder.DropTable(
                name: "UserBadges");

            migrationBuilder.DropTable(
                name: "GroupMeetingSchedules");

            migrationBuilder.DropTable(
                name: "GroupSets");

            migrationBuilder.DropTable(
                name: "GroupTunes");

            migrationBuilder.DropTable(
                name: "GroupSessions");

            migrationBuilder.DropTable(
                name: "Sets");

            migrationBuilder.DropTable(
                name: "UserTunes");

            migrationBuilder.DropTable(
                name: "Groups");

            migrationBuilder.DropTable(
                name: "TuneSettings");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "Tunes");
        }
    }
}
