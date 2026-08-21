using Microsoft.EntityFrameworkCore;
using SessionApp.Api.IntegrationTests.Infrastructure;
using SessionApp.Api.Models;

namespace SessionApp.Api.IntegrationTests;

public class CosmosSmokeTests(CosmosEmulatorFixture fixture) : CosmosTestBase(fixture)
{
    [Fact]
    public async Task TheProviderIsActuallyCosmos()
    {
        await Fixture.WithDbAsync(db =>
        {
            Assert.Equal("Microsoft.EntityFrameworkCore.Cosmos", db.Database.ProviderName);
            return Task.CompletedTask;
        });
    }

    [Fact]
    public async Task ADocumentRoundTrips()
    {
        var user = new User { DisplayName = "Smoke Test", Email = $"{Guid.CreateVersion7():N}@example.com" };

        await Fixture.WithDbAsync(async db =>
        {
            db.Users.Add(user);
            await db.SaveChangesAsync();
        });

        var loaded = await Fixture.WithDbAsync(db =>
            db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == user.UserId));

        Assert.NotNull(loaded);
        Assert.Equal("Smoke Test", loaded!.DisplayName);
    }
}
