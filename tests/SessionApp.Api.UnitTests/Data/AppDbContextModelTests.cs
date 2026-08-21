using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.UnitTests.Data;

/// <summary>
/// Guards <c>AppDbContext.OnModelCreating</c>, which builds a materially different model per
/// provider: relational providers get the FK graph and the unique indexes, while Cosmos severs
/// every cross-document navigation and gives each entity its own self-partitioned container.
/// Building the model needs no server, so these stay unit tests.
/// </summary>
public class AppDbContextModelTests
{
    private static AppDbContext SqliteContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseSqlite("Data Source=:memory:").Options);

    // The emulator's well-known key. Nothing here connects — but CosmosClient is constructed
    // eagerly when the model is first accessed, and it rejects a key that isn't valid base64.
    private const string EmulatorKey =
        "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

    private static AppDbContext CosmosContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseCosmos($"AccountEndpoint=https://localhost:8081/;AccountKey={EmulatorKey};", "model-only")
            .Options);

    [Fact]
    public void TheSqliteModelBuilds()
    {
        using var db = SqliteContext();

        Assert.NotEmpty(db.Model.GetEntityTypes());
    }

    [Fact]
    public void TheCosmosModelBuilds()
    {
        using var db = CosmosContext();

        Assert.NotEmpty(db.Model.GetEntityTypes());
    }

    [Fact]
    public void BothProvidersMapTheSameEntityTypes()
    {
        using var sqlite = SqliteContext();
        using var cosmos = CosmosContext();

        static string[] Names(AppDbContext db) =>
            [.. db.Model.GetEntityTypes().Select(e => e.ClrType.Name).Order()];

        Assert.Equal(Names(sqlite), Names(cosmos));
    }

    // --- Cosmos ---

    [Fact]
    public void Cosmos_EveryEntityGetsItsOwnContainerNamedAfterItsClrType()
    {
        using var db = CosmosContext();

        foreach (var entityType in db.Model.GetEntityTypes().Where(e => !e.IsOwned()))
        {
            Assert.Equal(entityType.ClrType.Name, entityType.GetContainer());
        }
    }

    [Fact]
    public void Cosmos_NoTwoEntitiesShareAContainer()
    {
        using var db = CosmosContext();

        var containers = db.Model.GetEntityTypes().Where(e => !e.IsOwned()).Select(e => e.GetContainer()).ToList();

        Assert.Equal(containers.Count, containers.Distinct().Count());
    }

    [Fact]
    public void Cosmos_EveryContainerIsPartitionedByItsDerivedPartitionKey()
    {
        using var db = CosmosContext();

        foreach (var entityType in db.Model.GetEntityTypes().Where(e => !e.IsOwned()))
        {
            var partitionKeys = entityType.GetPartitionKeyPropertyNames();
            Assert.Equal(["PartitionKey"], partitionKeys);

            var property = entityType.FindProperty("PartitionKey");
            Assert.NotNull(property);
            // Populated client-side from the entity's own id, so a document self-partitions.
            Assert.Equal(typeof(PartitionKeyValueGenerator), property!.GetValueGeneratorFactory()?
                .Invoke(property, entityType).GetType());
        }
    }

    [Fact]
    public void Cosmos_HasNoCrossDocumentNavigations()
    {
        using var db = CosmosContext();

        var offenders = db.Model.GetEntityTypes()
            .SelectMany(e => e.GetNavigations().Select(n => $"{e.ClrType.Name}.{n.Name}"))
            .Where(_ => true)
            .ToList();

        Assert.Empty(offenders);
    }

    [Fact]
    public void Cosmos_KeepsTheScalarForeignKeyIdsThatQueriesStitchOn()
    {
        using var db = CosmosContext();

        // The navigation is gone but UserTune.UserId / .TuneId must survive — every
        // Cosmos query filters and stitches on them instead.
        var userTune = db.Model.FindEntityType(typeof(UserTune))!;
        Assert.NotNull(userTune.FindProperty(nameof(UserTune.UserId)));
        Assert.NotNull(userTune.FindProperty(nameof(UserTune.TuneId)));
        Assert.NotNull(userTune.FindProperty(nameof(UserTune.TuneSettingId)));

        var setItem = db.Model.FindEntityType(typeof(SetItem))!;
        Assert.NotNull(setItem.FindProperty(nameof(SetItem.SetId)));
        Assert.NotNull(setItem.FindProperty(nameof(SetItem.UserTuneId)));
    }

    [Fact]
    public void Cosmos_DeclaresNoRelationalIndexes()
    {
        using var db = CosmosContext();

        // Uniqueness is enforced in application code on Cosmos; the index declarations
        // are guarded behind the isRelational flag and must not leak into this model.
        var indexed = db.Model.GetEntityTypes().Where(e => e.GetIndexes().Any()).Select(e => e.ClrType.Name).ToList();

        Assert.Empty(indexed);
    }

    // --- Relational ---

    [Fact]
    public void Sqlite_KeepsTheNavigationsCosmosSevers()
    {
        using var db = SqliteContext();

        var userTune = db.Model.FindEntityType(typeof(UserTune))!;
        var navigations = userTune.GetNavigations().Select(n => n.Name).ToList();

        Assert.Contains(nameof(UserTune.User), navigations);
        Assert.Contains(nameof(UserTune.Tune), navigations);
    }

    [Theory]
    [InlineData(typeof(User), nameof(User.Email))]
    [InlineData(typeof(User), nameof(User.Username))]
    [InlineData(typeof(Group), nameof(Group.InviteCode))]
    public void Sqlite_DeclaresTheSingleColumnUniqueIndexes(Type entity, string propertyName)
    {
        using var db = SqliteContext();

        var index = db.Model.FindEntityType(entity)!.GetIndexes()
            .SingleOrDefault(i => i.Properties.Count == 1 && i.Properties[0].Name == propertyName);

        Assert.NotNull(index);
        Assert.True(index!.IsUnique, $"{entity.Name}.{propertyName} index should be unique");
    }

    [Theory]
    // The composite uniqueness rules the app relies on, one per join/idempotency entity.
    [InlineData(typeof(UserTune), new[] { nameof(UserTune.UserId), nameof(UserTune.TuneId) })]
    [InlineData(typeof(GroupMembership), new[] { nameof(GroupMembership.GroupId), nameof(GroupMembership.UserId) })]
    [InlineData(typeof(GroupTune), new[] { nameof(GroupTune.GroupId), nameof(GroupTune.TuneId) })]
    [InlineData(typeof(SetItem), new[] { nameof(SetItem.SetId), nameof(SetItem.SequenceNumber) })]
    [InlineData(typeof(GroupSetItem), new[] { nameof(GroupSetItem.GroupSetId), nameof(GroupSetItem.SequenceNumber) })]
    [InlineData(typeof(SessionRsvp), new[] { nameof(SessionRsvp.GroupSessionId), nameof(SessionRsvp.UserId) })]
    [InlineData(typeof(TuneSettingVote), new[] { nameof(TuneSettingVote.TuneSettingId), nameof(TuneSettingVote.UserId) })]
    [InlineData(typeof(UserBadge), new[] { nameof(UserBadge.UserId), nameof(UserBadge.BadgeKey) })]
    [InlineData(typeof(Friendship), new[] { nameof(Friendship.RequesterId), nameof(Friendship.ReceiverId) })]
    [InlineData(typeof(PointsTransaction), new[] { nameof(PointsTransaction.UserId), nameof(PointsTransaction.Reason), nameof(PointsTransaction.SourceId) })]
    public void Sqlite_DeclaresTheCompositeUniqueIndexes(Type entity, string[] propertyNames)
    {
        using var db = SqliteContext();

        var index = db.Model.FindEntityType(entity)!.GetIndexes()
            .SingleOrDefault(i => i.Properties.Select(p => p.Name).SequenceEqual(propertyNames));

        Assert.NotNull(index);
        Assert.True(index!.IsUnique, $"{entity.Name}({string.Join(", ", propertyNames)}) index should be unique");
    }

    // --- Provider-independent ---

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void PrimaryKeysAreNeverDatabaseGenerated(bool cosmos)
    {
        // Every id is a client-generated UUID v7 (see each model's initializer), so EF
        // must not wait on the store to assign one.
        using var db = cosmos ? CosmosContext() : SqliteContext();

        foreach (var entityType in db.Model.GetEntityTypes())
        {
            foreach (var property in entityType.FindPrimaryKey()?.Properties ?? [])
            {
                if (property.ClrType == typeof(Guid))
                {
                    Assert.Equal(ValueGenerated.Never, property.ValueGenerated);
                }
            }
        }
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void EnumsArePersistedAsStringsOnBothProviders(bool cosmos)
    {
        using var db = cosmos ? CosmosContext() : SqliteContext();

        var status = db.Model.FindEntityType(typeof(UserTune))!.FindProperty(nameof(UserTune.Status))!;
        Assert.Equal(typeof(string), status.GetProviderClrType() ?? status.GetTypeMapping().Converter?.ProviderClrType);

        var role = db.Model.FindEntityType(typeof(GroupMembership))!.FindProperty(nameof(GroupMembership.Role))!;
        Assert.Equal(typeof(string), role.GetProviderClrType() ?? role.GetTypeMapping().Converter?.ProviderClrType);
    }
}
