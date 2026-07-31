using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using SessionApp.Api.Models;

namespace SessionApp.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Tune> Tunes => Set<Tune>();
    public DbSet<UserTune> UserTunes => Set<UserTune>();
    public DbSet<Models.Set> Sets => Set<Models.Set>();
    public DbSet<SetItem> SetItems => Set<SetItem>();
    public DbSet<Group> Groups => Set<Group>();
    public DbSet<GroupMembership> GroupMemberships => Set<GroupMembership>();
    public DbSet<GroupUpdate> GroupUpdates => Set<GroupUpdate>();
    public DbSet<GroupMeetingSchedule> GroupMeetingSchedules => Set<GroupMeetingSchedule>();
    public DbSet<GroupTune> GroupTunes => Set<GroupTune>();
    public DbSet<GroupSet> GroupSets => Set<GroupSet>();
    public DbSet<GroupSetItem> GroupSetItems => Set<GroupSetItem>();
    public DbSet<GroupSession> GroupSessions => Set<GroupSession>();
    public DbSet<SessionRsvp> SessionRsvps => Set<SessionRsvp>();
    public DbSet<PracticeLogEntry> PracticeLog => Set<PracticeLogEntry>();
    public DbSet<EarTrainingProgress> EarTrainingProgress => Set<EarTrainingProgress>();
    public DbSet<TuneAlias> TuneAliases => Set<TuneAlias>();
    public DbSet<TuneSetting> TuneSettings => Set<TuneSetting>();
    public DbSet<TuneSettingVote> TuneSettingVotes => Set<TuneSettingVote>();
    public DbSet<GroupFeedEvent> GroupFeedEvents => Set<GroupFeedEvent>();
    public DbSet<GroupScheduleException> GroupScheduleExceptions => Set<GroupScheduleException>();
    public DbSet<PointsTransaction> PointsTransactions => Set<PointsTransaction>();
    public DbSet<UserBadge> UserBadges => Set<UserBadge>();
    public DbSet<Friendship> Friendships => Set<Friendship>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // User <-> Tune many-to-many through the explicit UserTune join entity.
        modelBuilder.Entity<UserTune>(entity =>
        {
            entity.HasOne(ut => ut.User)
                .WithMany(u => u.UserTunes)
                .HasForeignKey(ut => ut.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(ut => ut.Tune)
                .WithMany(t => t.UserTunes)
                .HasForeignKey(ut => ut.TuneId)
                .OnDelete(DeleteBehavior.Cascade);

            // A user holds at most one instance of a given tune.
            entity.HasIndex(ut => new { ut.UserId, ut.TuneId }).IsUnique();
            entity.HasIndex(ut => new { ut.UserId, ut.Status });
            entity.HasIndex(ut => new { ut.UserId, ut.LastPracticed });

            entity.Property(ut => ut.Status).HasConversion<string>().HasMaxLength(20);

            entity.HasOne(ut => ut.TuneSetting)
                .WithMany(s => s.UserTunes)
                .HasForeignKey(ut => ut.TuneSettingId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Models.Set>(entity =>
        {
            entity.HasOne(s => s.User)
                .WithMany(u => u.Sets)
                .HasForeignKey(s => s.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Set <-> UserTune many-to-many through the explicit SetItem join entity.
        modelBuilder.Entity<SetItem>(entity =>
        {
            entity.HasOne(si => si.Set)
                .WithMany(s => s.Items)
                .HasForeignKey(si => si.SetId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(si => si.UserTune)
                .WithMany(ut => ut.SetItems)
                .HasForeignKey(si => si.UserTuneId)
                .OnDelete(DeleteBehavior.Restrict); // avoid multiple cascade paths in SQL Server

            entity.HasIndex(si => new { si.SetId, si.SequenceNumber }).IsUnique();
        });

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasIndex(u => u.Email).IsUnique();
            entity.HasIndex(u => u.Username).IsUnique();
            entity.Property(u => u.Username).HasMaxLength(30);
        });

        // User <-> Group many-to-many through the explicit GroupMembership join entity,
        // which also carries the member's role (Member/Administrator/Owner).
        modelBuilder.Entity<GroupMembership>(entity =>
        {
            entity.HasOne(gm => gm.Group)
                .WithMany(g => g.Memberships)
                .HasForeignKey(gm => gm.GroupId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(gm => gm.User)
                .WithMany(u => u.GroupMemberships)
                .HasForeignKey(gm => gm.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // A user holds at most one membership row per group.
            entity.HasIndex(gm => new { gm.GroupId, gm.UserId }).IsUnique();

            entity.Property(gm => gm.Role).HasConversion<string>().HasMaxLength(20);
            entity.Property(gm => gm.Status).HasConversion<string>().HasMaxLength(20);
        });

        modelBuilder.Entity<Group>(entity =>
        {
            entity.HasIndex(g => g.InviteCode).IsUnique();
            entity.Property(g => g.TimeZone).HasMaxLength(64);
        });

        modelBuilder.Entity<GroupUpdate>(entity =>
        {
            entity.HasOne(gu => gu.Group)
                .WithMany(g => g.Updates)
                .HasForeignKey(gu => gu.GroupId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(gu => gu.CreatedByUser)
                .WithMany()
                .HasForeignKey(gu => gu.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(gu => gu.CreatedAt);
        });

        modelBuilder.Entity<GroupMeetingSchedule>(entity =>
        {
            entity.HasOne(gms => gms.Group)
                .WithMany(g => g.Schedules)
                .HasForeignKey(gms => gms.GroupId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.Property(gms => gms.RecurrencePattern).HasConversion<string>().HasMaxLength(20);
        });

        modelBuilder.Entity<GroupScheduleException>(entity =>
        {
            entity.HasOne(e => e.GroupMeetingSchedule)
                .WithMany(gms => gms.Exceptions)
                .HasForeignKey(e => e.GroupMeetingScheduleId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.CreatedByUser)
                .WithMany()
                .HasForeignKey(e => e.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);

            // A schedule can only be cancelled once for a given date.
            entity.HasIndex(e => new { e.GroupMeetingScheduleId, e.ExceptionDate }).IsUnique();
        });

        modelBuilder.Entity<GroupFeedEvent>(entity =>
        {
            entity.HasOne(e => e.Group)
                .WithMany()
                .HasForeignKey(e => e.GroupId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.User)
                .WithMany()
                .HasForeignKey(e => e.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.Property(e => e.EventType).HasConversion<string>().HasMaxLength(20);

            // Feed listing reads by group ordered by recency; the dedupe/merge check on
            // write reads by (group, user) regardless of order.
            entity.HasIndex(e => new { e.GroupId, e.CreatedAt });
            entity.HasIndex(e => new { e.GroupId, e.UserId });
        });

        // A group's curated master tune list, mirroring the UserTune pattern:
        // each entry optionally pins a specific TuneSetting.
        modelBuilder.Entity<GroupTune>(entity =>
        {
            entity.HasOne(gt => gt.Group)
                .WithMany(g => g.GroupTunes)
                .HasForeignKey(gt => gt.GroupId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(gt => gt.Tune)
                .WithMany()
                .HasForeignKey(gt => gt.TuneId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(gt => gt.TuneSetting)
                .WithMany()
                .HasForeignKey(gt => gt.TuneSettingId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(gt => gt.AddedByUser)
                .WithMany()
                .HasForeignKey(gt => gt.AddedByUserId)
                .OnDelete(DeleteBehavior.Restrict);

            // A tune appears at most once on a group's master list.
            entity.HasIndex(gt => new { gt.GroupId, gt.TuneId }).IsUnique();
        });

        modelBuilder.Entity<GroupSet>(entity =>
        {
            entity.HasOne(gs => gs.Group)
                .WithMany()
                .HasForeignKey(gs => gs.GroupId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // GroupSet <-> GroupTune many-to-many through the explicit GroupSetItem join entity.
        modelBuilder.Entity<GroupSetItem>(entity =>
        {
            entity.HasOne(gsi => gsi.GroupSet)
                .WithMany(gs => gs.Items)
                .HasForeignKey(gsi => gsi.GroupSetId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(gsi => gsi.GroupTune)
                .WithMany()
                .HasForeignKey(gsi => gsi.GroupTuneId)
                .OnDelete(DeleteBehavior.Restrict); // avoid multiple cascade paths in SQL Server

            entity.HasIndex(gsi => new { gsi.GroupSetId, gsi.SequenceNumber }).IsUnique();
        });

        modelBuilder.Entity<GroupSession>(entity =>
        {
            entity.HasOne(gs => gs.Group)
                .WithMany()
                .HasForeignKey(gs => gs.GroupId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(gs => gs.CreatedByUser)
                .WithMany()
                .HasForeignKey(gs => gs.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(gs => new { gs.GroupId, gs.StartsAt });
        });

        modelBuilder.Entity<SessionRsvp>(entity =>
        {
            entity.HasOne(r => r.GroupSession)
                .WithMany(gs => gs.Rsvps)
                .HasForeignKey(r => r.GroupSessionId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(r => r.User)
                .WithMany()
                .HasForeignKey(r => r.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // A user holds at most one RSVP per session.
            entity.HasIndex(r => new { r.GroupSessionId, r.UserId }).IsUnique();

            entity.Property(r => r.Status).HasConversion<string>().HasMaxLength(20);
        });

        modelBuilder.Entity<PracticeLogEntry>(entity =>
        {
            entity.HasOne(p => p.UserTune)
                .WithMany(ut => ut.PracticeLog)
                .HasForeignKey(p => p.UserTuneId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(p => p.PracticedAt);
        });

        modelBuilder.Entity<EarTrainingProgress>(entity =>
        {
            entity.HasOne(e => e.UserTune)
                .WithMany()
                .HasForeignKey(e => e.UserTuneId)
                .OnDelete(DeleteBehavior.Cascade);

            // One resumable ear-training state per user tune.
            entity.HasIndex(e => e.UserTuneId).IsUnique();
        });

        modelBuilder.Entity<Tune>(entity =>
        {
            entity.Property(t => t.TuneType).HasConversion<string>().HasMaxLength(20);
            entity.Property(t => t.Key).HasMaxLength(10);
            entity.HasIndex(t => t.Title);
        });

        modelBuilder.Entity<TuneAlias>(entity =>
        {
            entity.HasOne(a => a.Tune)
                .WithMany(t => t.Aliases)
                .HasForeignKey(a => a.TuneId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TuneSetting>(entity =>
        {
            entity.HasOne(s => s.Tune)
                .WithMany(t => t.Settings)
                .HasForeignKey(s => s.TuneId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TuneSettingVote>(entity =>
        {
            entity.HasOne(v => v.TuneSetting)
                .WithMany(s => s.Votes)
                .HasForeignKey(v => v.TuneSettingId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(v => v.User)
                .WithMany()
                .HasForeignKey(v => v.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(v => new { v.TuneSettingId, v.UserId }).IsUnique();
        });

        modelBuilder.Entity<PointsTransaction>(entity =>
        {
            entity.HasOne(t => t.User)
                .WithMany()
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.Property(t => t.Reason).HasConversion<string>().HasMaxLength(30);
            entity.Property(t => t.SourceId).HasMaxLength(200);

            // The idempotency guard: the same (user, reason, sourceId) is never awarded twice.
            entity.HasIndex(t => new { t.UserId, t.Reason, t.SourceId }).IsUnique();
        });

        modelBuilder.Entity<UserBadge>(entity =>
        {
            entity.HasOne(b => b.User)
                .WithMany()
                .HasForeignKey(b => b.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.Property(b => b.BadgeKey).HasMaxLength(50);

            // A badge is earned by a user at most once.
            entity.HasIndex(b => new { b.UserId, b.BadgeKey }).IsUnique();
        });

        modelBuilder.Entity<Friendship>(entity =>
        {
            entity.HasOne(f => f.Requester)
                .WithMany()
                .HasForeignKey(f => f.RequesterId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(f => f.Receiver)
                .WithMany()
                .HasForeignKey(f => f.ReceiverId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(f => new { f.RequesterId, f.ReceiverId }).IsUnique();
            entity.HasIndex(f => new { f.ReceiverId, f.Status });
            entity.HasIndex(f => new { f.RequesterId, f.Status });

            entity.Property(f => f.Status).HasConversion<string>().HasMaxLength(20);
        });

        // All primary keys are client-generated UUID v7 values (see each model's
        // default initializer), so tell EF not to expect the database to assign them.
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            var primaryKey = entityType.FindPrimaryKey();
            if (primaryKey is null)
            {
                continue;
            }
            foreach (var property in primaryKey.Properties)
            {
                if (property.ClrType == typeof(Guid))
                {
                    property.ValueGenerated = ValueGenerated.Never;
                }
            }
        }
    }
}
