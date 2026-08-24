using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Functions;
using SessionApp.Api.IntegrationTests.Infrastructure;
using SessionApp.Api.Models;
using SessionApp.Api.Services;

namespace SessionApp.Api.IntegrationTests;

/// <summary>
/// Regression locks on the Cosmos-specific query workarounds the codebase is built around. Each
/// test pins both halves: the workaround still works, <em>and</em> the naive form it replaced still
/// fails. If a future EF/Cosmos upgrade fixes the underlying provider bug, the "still fails" half
/// turns red — which is the signal to delete the workaround, not to widen the test.
/// </summary>
public class CosmosTranslationTests(CosmosEmulatorFixture fixture) : CosmosTestBase(fixture)
{
    [Fact]
    public async Task TuneMatchIndex_RebuildsOverADocumentPredatingTheDifficultyProperty()
    {
        // The Identify page's 500: TuneMatchIndex projected t.Difficulty (a non-nullable int)
        // straight out of the query, and a tune document written before Difficulty existed on the
        // model doesn't carry the property at all. The Cosmos projection shaper throws "Nullable
        // object must have a value" reading that absence into an int, and because the rebuild is
        // lazy and retried per request, one such document took out /api/tunes/match permanently.
        var legacy = await SeedAsync(db => db.SeedTuneAsync("Predates Heuristics"));
        var current = await SeedAsync(db => db.SeedTuneAsync("Drowsy Maggie", abc: TestData.DrowsyMaggieAbc));

        await Fixture.StripPropertiesAsync(nameof(Tune), legacy.TuneId, nameof(Tune.Difficulty));

        var index = Fixture.MatchIndex;
        await index.ForceRefreshAsync();

        // The tune that still has its fingerprint is matchable — i.e. the index built at all.
        var query = MelodyFingerprint.ParseIntervalString(current.FingerprintIntervals);
        var result = await index.MatchAsync(query);

        Assert.Contains(result, r => r.TuneId == current.TuneId);
    }

    [Fact]
    public async Task ProjectingANonNullableValueTypeOutOfALegacyDocument_StillFailsOnCosmos()
    {
        // The "still fails" half: this is the shape TuneMatchIndex used to have, and the reason it
        // now materializes entities instead. If a future EF/Cosmos upgrade makes this pass, the
        // materialize-then-map workaround here and in Public/Functions/Tunes/Get.cs can go.
        var legacy = await SeedAsync(db => db.SeedTuneAsync("Also Predates Heuristics"));
        await Fixture.StripPropertiesAsync(nameof(Tune), legacy.TuneId, nameof(Tune.Difficulty));

        await Fixture.WithDbAsync(async db =>
        {
            // Materializing the entity defaults the missing property...
            var materialized = await db.Tunes.AsNoTracking()
                .Where(t => t.TuneId == legacy.TuneId).ToListAsync();
            Assert.Equal(0, materialized.Single().Difficulty);

            // ...but projecting it into a non-nullable int does not survive the shaper.
            await Assert.ThrowsAnyAsync<Exception>(() => db.Tunes.AsNoTracking()
                .Where(t => t.TuneId == legacy.TuneId)
                .Select(t => new { t.TuneId, t.Difficulty })
                .ToListAsync());
        });
    }

    [Fact]
    public async Task CosmosAnyAsync_AnswersAnExistenceCheck()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync());
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune));

        await Fixture.WithDbAsync(async db =>
        {
            Assert.True(await db.UserTunes.Where(ut => ut.UserId == user.UserId).CosmosAnyAsync());
            Assert.False(await db.UserTunes.Where(ut => ut.UserId == TestData.NewId()).CosmosAnyAsync());
        });
    }

    [Fact]
    public async Task AnyAsyncWithAPredicate_StillFailsOnCosmos()
    {
        // The provider emits an EXISTS form with an unresolved `root` identifier, which Cosmos
        // rejects (SC2001 BadRequest). This is *why* CosmosAnyAsync exists — see CosmosStitch.
        // Kept as an explicit lock: the day this stops throwing, the workaround can be deleted.
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync());
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune));

        await Fixture.WithDbAsync(async db =>
        {
            // The same question, asked the supported way, answers fine...
            Assert.True(await db.UserTunes.Where(ut => ut.UserId == user.UserId).CosmosAnyAsync());

            // ...but the natural LINQ spelling of it does not survive translation.
            await Assert.ThrowsAnyAsync<Exception>(
                () => db.UserTunes.AnyAsync(ut => ut.UserId == user.UserId));
        });
    }

    [Fact]
    public async Task CosmosCountAsync_CountsAFilteredProjection()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync());
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune, TuneStatus.Active));
        var second = await SeedAsync(db => db.SeedTuneAsync("Drowsy Maggie", abc: TestData.DrowsyMaggieAbc));
        await SeedAsync(db => db.SeedUserTuneAsync(user, second, TuneStatus.Learning));

        var count = await Fixture.WithDbAsync(db => db.UserTunes
            .Where(ut => ut.UserId == user.UserId)
            .Select(ut => ut.UserTuneId)
            .CosmosCountAsync());

        Assert.Equal(2, count);
    }

    [Fact]
    public async Task CosmosCountAsync_AgreesWithTheCountTheEmulatorItselfReports()
    {
        // Deliberately *not* asserted as "CountAsync(predicate) still throws": unlike AnyAsync,
        // the naive form is accepted by the emulator even though CosmosStitch documents the
        // service rejecting it with the same SC2001. Locking in the emulator's more permissive
        // behaviour would assert a fidelity gap rather than the app's contract, so this only
        // pins that the workaround returns the right number.
        var user = await SeedAsync(db => db.SeedUserAsync());
        for (var i = 0; i < 3; i++)
        {
            var tune = await SeedAsync(db => db.SeedTuneAsync($"Counted {i}"));
            await SeedAsync(db => db.SeedUserTuneAsync(user, tune));
        }

        var counted = await Fixture.WithDbAsync(db => db.UserTunes
            .Where(ut => ut.UserId == user.UserId)
            .Select(ut => ut.UserTuneId)
            .CosmosCountAsync());

        Assert.Equal(3, counted);
    }

    [Fact]
    public async Task Include_AcrossDocumentsIsNotEvenExpressible()
    {
        // The Cosmos model ignores every cross-document navigation, so UserTune.Tune is not a
        // mapped navigation at all and Include throws before a query is ever sent. This is the
        // compile-time-invisible constraint that forces the id-stitching pattern in SetSupport.
        await Fixture.WithDbAsync(db =>
        {
            Assert.ThrowsAny<Exception>(() => db.UserTunes.Include(ut => ut.Tune).ToQueryString());
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task ToDictionaryByIdAsync_KeysAStitchLookup()
    {
        var cooleys = await SeedAsync(db => db.SeedTuneAsync("Cooley's"));
        var maggie = await SeedAsync(db => db.SeedTuneAsync("Drowsy Maggie", abc: TestData.DrowsyMaggieAbc));
        var ids = new[] { cooleys.TuneId, maggie.TuneId };

        var byId = await Fixture.WithDbAsync(db => db.Tunes
            .AsNoTracking()
            .Where(t => ids.Contains(t.TuneId))
            .ToDictionaryByIdAsync(t => t.TuneId));

        Assert.Equal(2, byId.Count);
        Assert.Equal("Cooley's", byId[cooleys.TuneId].Title);
        Assert.Equal("Drowsy Maggie", byId[maggie.TuneId].Title);
    }

    [Fact]
    public async Task ContainsOnAnIdList_TranslatesCleanly()
    {
        // The stitch pattern leans on `ids.Contains(x)` everywhere; if that ever stopped
        // translating, every list endpoint would break at once.
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tunes = new List<Tune>();
        for (var i = 0; i < 3; i++)
        {
            tunes.Add(await SeedAsync(db => db.SeedTuneAsync($"Tune {i}")));
        }
        foreach (var tune in tunes)
        {
            await SeedAsync(db => db.SeedUserTuneAsync(user, tune));
        }

        var wanted = tunes.Take(2).Select(t => t.TuneId).ToList();
        var found = await Fixture.WithDbAsync(db => db.Tunes
            .AsNoTracking()
            .Where(t => wanted.Contains(t.TuneId))
            .ToListAsync());

        Assert.Equal(2, found.Count);
    }

    [Fact]
    public async Task EnumsRoundTripAsStrings()
    {
        var user = await SeedAsync(db => db.SeedUserAsync());
        var tune = await SeedAsync(db => db.SeedTuneAsync(tuneType: TuneType.SlipJig));
        await SeedAsync(db => db.SeedUserTuneAsync(user, tune, TuneStatus.Rusty));

        var loaded = await Fixture.WithDbAsync(db => db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == user.UserId)
            .SingleAsync());

        Assert.Equal(TuneStatus.Rusty, loaded.Status);

        // ...and the string form is what the server filters on.
        var filtered = await Fixture.WithDbAsync(db => db.UserTunes
            .AsNoTracking()
            .Where(ut => ut.UserId == user.UserId && ut.Status == TuneStatus.Rusty)
            .ToListAsync());

        Assert.Single(filtered);
    }

    [Fact]
    public async Task ADocumentIsReachableByItsOwnPartitionKey()
    {
        // Each entity lives in its own container partitioned by a PartitionKey derived from its id,
        // so a filter on the id is a single-partition read rather than a fan-out.
        var tune = await SeedAsync(db => db.SeedTuneAsync("Partitioned"));

        var loaded = await Fixture.WithDbAsync(db =>
            db.Tunes.AsNoTracking().SingleOrDefaultAsync(t => t.TuneId == tune.TuneId));

        Assert.NotNull(loaded);
        Assert.Equal("Partitioned", loaded!.Title);
    }
}
