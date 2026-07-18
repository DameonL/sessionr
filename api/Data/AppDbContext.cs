using Microsoft.EntityFrameworkCore;
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
    public DbSet<PracticeLogEntry> PracticeLog => Set<PracticeLogEntry>();

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

            entity.Property(ut => ut.Status).HasConversion<string>().HasMaxLength(20);
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

        // User <-> Group many-to-many via an implicit join table.
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasMany(u => u.Groups)
                .WithMany(g => g.Members)
                .UsingEntity(j => j.ToTable("GroupMemberships"));

            entity.HasIndex(u => u.Email).IsUnique();
        });

        modelBuilder.Entity<PracticeLogEntry>(entity =>
        {
            entity.HasOne(p => p.UserTune)
                .WithMany(ut => ut.PracticeLog)
                .HasForeignKey(p => p.UserTuneId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(p => p.PracticedAt);
        });

        modelBuilder.Entity<Tune>(entity =>
        {
            entity.Property(t => t.TuneType).HasConversion<string>().HasMaxLength(20);
            entity.Property(t => t.Key).HasMaxLength(10);
            entity.HasIndex(t => t.Title);
        });
    }
}
