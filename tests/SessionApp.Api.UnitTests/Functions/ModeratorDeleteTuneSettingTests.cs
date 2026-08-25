using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using SessionApp.Api.Data;
using SessionApp.Api.Functions.Moderator.Tunes.Settings.BySettingId;
using SessionApp.Api.Models;
using SessionApp.Api.Services;
using SessionApp.Api.TestSupport;
using Xunit;

namespace SessionApp.Api.UnitTests.Functions;

public class ModeratorDeleteTuneSettingTests
{
    private static AppDbContext CreateInMemoryDb()
    {
        var connection = new Microsoft.Data.Sqlite.SqliteConnection("Data Source=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection)
            .Options;
        var db = new AppDbContext(options);
        db.Database.EnsureCreated();
        return db;
    }

    private static ICloudflareCachePurgeService CreatePurgeService() =>
        new CloudflareCachePurgeService(new HttpClient(), NullLogger<CloudflareCachePurgeService>.Instance);

    [Fact]
    public async Task ModeratorDeleteTuneSetting_NonModerator_ReturnsForbidden()
    {
        using var db = CreateInMemoryDb();
        var handler = new Delete(db, CreatePurgeService());
        var req = TestRequest.For(Guid.NewGuid(), moderator: false);

        var result = await handler.ModeratorDeleteTuneSetting(req, Guid.NewGuid());

        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(403, objectResult.StatusCode);
    }

    [Fact]
    public async Task ModeratorDeleteTuneSetting_SettingNotFound_ReturnsNotFound()
    {
        using var db = CreateInMemoryDb();
        var handler = new Delete(db, CreatePurgeService());
        var req = TestRequest.For(Guid.NewGuid(), moderator: true);

        var result = await handler.ModeratorDeleteTuneSetting(req, Guid.NewGuid());

        Assert.IsType<NotFoundResult>(result);
    }

    [Fact]
    public async Task ModeratorDeleteTuneSetting_ValidSetting_DeletesSettingAndReturnsNoContent()
    {
        using var db = CreateInMemoryDb();
        var tuneId = Guid.NewGuid();
        var settingId = Guid.NewGuid();

        db.Tunes.Add(new Tune
        {
            TuneId = tuneId,
            Title = "The Kesh",
            TuneType = TuneType.Jig,
            Key = "G",
            MasterAbcText = "X:1\nT:The Kesh\nR:jig\nK:G\nGABc|"
        });

        db.TuneSettings.Add(new TuneSetting
        {
            TuneSettingId = settingId,
            TuneId = tuneId,
            Key = "G",
            AbcText = "X:1\nT:The Kesh\nR:jig\nK:G\nGABc|",
            SubmitterName = "TestUser",
            VoteScore = 5
        });
        await db.SaveChangesAsync();

        var handler = new Delete(db, CreatePurgeService());
        var req = TestRequest.For(Guid.NewGuid(), moderator: true);

        var result = await handler.ModeratorDeleteTuneSetting(req, settingId);

        Assert.IsType<NoContentResult>(result);
        var remainingSetting = await db.TuneSettings.SingleOrDefaultAsync(s => s.TuneSettingId == settingId);
        Assert.Null(remainingSetting);
    }
}
