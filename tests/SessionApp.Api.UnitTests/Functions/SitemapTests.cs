extern alias publicapi;

using System;
using System.Linq;
using System.Threading.Tasks;
using System.Xml.Linq;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;
using SessionApp.Api.TestSupport;
using Xunit;
using SitemapGet = publicapi::SessionApp.Api.Functions.Sitemap.Get;

namespace SessionApp.Api.UnitTests.Functions;

public class SitemapTests
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

    private static HttpRequest CreateGetRequest() => new DefaultHttpContext().Request;

    [Fact]
    public async Task GetSitemapIndex_ReturnsValidSitemapIndexXml()
    {
        using var db = CreateInMemoryDb();
        var handler = new SitemapGet(db);

        var result = await handler.GetSitemapIndex(CreateGetRequest());
        var content = Assert.IsType<ContentResult>(result);
        Assert.Equal("application/xml; charset=utf-8", content.ContentType);

        var doc = XDocument.Parse(content.Content!);
        XNamespace ns = "http://www.sitemaps.org/schemas/sitemap/0.9";
        var locs = doc.Descendants(ns + "loc");
        Assert.Contains(locs, x => x.Value == "https://sessionr.org/sitemap-static.xml");
        Assert.Contains(locs, x => x.Value == "https://sessionr.org/sitemap-tunes.xml");
        Assert.Contains(locs, x => x.Value == "https://sessionr.org/sitemap-groups.xml");
        Assert.Contains(locs, x => x.Value == "https://sessionr.org/sitemap-sets.xml");
        Assert.DoesNotContain(locs, x => x.Value.Contains("profile"));
    }

    [Fact]
    public async Task GetTunesSitemap_IncludesTunes()
    {
        using var db = CreateInMemoryDb();
        var tuneId = Guid.NewGuid();
        db.Tunes.Add(new Tune
        {
            TuneId = tuneId,
            Title = "Cooley's Reel",
            TuneType = TuneType.Reel,
            Key = "Edor",
            MasterAbcText = "X:1\nT:Cooley's Reel\nR:reel\nK:Edor\nEBBA|",
        });
        await db.SaveChangesAsync();

        var handler = new SitemapGet(db);
        var result = await handler.GetTunesSitemap(CreateGetRequest());
        var content = Assert.IsType<ContentResult>(result);
        var doc = XDocument.Parse(content.Content!);
        XNamespace ns = "http://www.sitemaps.org/schemas/sitemap/0.9";
        var locs = doc.Descendants(ns + "loc");
        Assert.Single(locs, x => x.Value == $"https://sessionr.org/tunes/{tuneId}");
    }

    [Fact]
    public async Task GetGroupsSitemap_ExcludesPrivateGroups()
    {
        using var db = CreateInMemoryDb();
        var publicGroupId = Guid.NewGuid();
        var privateGroupId = Guid.NewGuid();
        db.Groups.AddRange(
            new Group { GroupId = publicGroupId, Name = "Public Session", IsPrivate = false },
            new Group { GroupId = privateGroupId, Name = "Secret Session", IsPrivate = true }
        );
        await db.SaveChangesAsync();

        var handler = new SitemapGet(db);
        var result = await handler.GetGroupsSitemap(CreateGetRequest());
        var content = Assert.IsType<ContentResult>(result);
        var doc = XDocument.Parse(content.Content!);
        XNamespace ns = "http://www.sitemaps.org/schemas/sitemap/0.9";
        var locs = doc.Descendants(ns + "loc");
        Assert.Contains(locs, x => x.Value == $"https://sessionr.org/group/{publicGroupId}");
        Assert.DoesNotContain(locs, x => x.Value == $"https://sessionr.org/group/{privateGroupId}");
    }

    [Fact]
    public async Task GetSetsSitemap_IncludesPublicOwnerSets_ExcludesPrivateOwnersAndProfiles()
    {
        using var db = CreateInMemoryDb();
        var publicUserId = Guid.NewGuid();
        var privateUserId = Guid.NewGuid();
        var publicSetId = Guid.NewGuid();
        var privateSetId = Guid.NewGuid();

        db.Users.AddRange(
            new User { UserId = publicUserId, DisplayName = "Public Player", Email = "pub@example.com", Username = "pubplayer", IsProfilePrivate = false },
            new User { UserId = privateUserId, DisplayName = "Private Player", Email = "priv@example.com", Username = "privplayer", IsProfilePrivate = true }
        );
        db.Sets.AddRange(
            new Set { SetId = publicSetId, UserId = publicUserId, Title = "Jig Set" },
            new Set { SetId = privateSetId, UserId = privateUserId, Title = "Hidden Set" }
        );
        await db.SaveChangesAsync();

        var handler = new SitemapGet(db);
        var result = await handler.GetSetsSitemap(CreateGetRequest());
        var content = Assert.IsType<ContentResult>(result);
        var doc = XDocument.Parse(content.Content!);
        XNamespace ns = "http://www.sitemaps.org/schemas/sitemap/0.9";
        var locs = doc.Descendants(ns + "loc");
        Assert.Contains(locs, x => x.Value == $"https://sessionr.org/set/{publicSetId}");
        Assert.DoesNotContain(locs, x => x.Value == $"https://sessionr.org/set/{privateSetId}");
        Assert.DoesNotContain(locs, x => x.Value.Contains("/profile/"));
    }

    [Fact]
    public async Task GetSitemapIndex_SplitsTunesAcrossPagesWhenAbovePageLimit()
    {
        using var db = CreateInMemoryDb();
        db.LibraryStats.Add(new LibraryStats { TuneCount = 5001 });
        await db.SaveChangesAsync();

        var handler = new SitemapGet(db);
        var result = await handler.GetSitemapIndex(CreateGetRequest());
        var content = Assert.IsType<ContentResult>(result);
        var doc = XDocument.Parse(content.Content!);
        XNamespace ns = "http://www.sitemaps.org/schemas/sitemap/0.9";
        var locs = doc.Descendants(ns + "loc").Select(x => x.Value).ToList();

        Assert.Contains("https://sessionr.org/sitemap-tunes.xml?page=1", locs);
        Assert.Contains("https://sessionr.org/sitemap-tunes.xml?page=2", locs);
    }

    [Fact]
    public async Task GetTunesSitemap_PaginatesAtFiveThousandEntries()
    {
        using var db = CreateInMemoryDb();
        for (var i = 0; i < 5001; i++)
        {
            db.Tunes.Add(new Tune
            {
                Title = $"Tune {i}",
                TuneType = TuneType.Reel,
                Key = "D",
                MasterAbcText = "K:D\nDEFG|",
                CreatedAt = DateTime.MinValue,
            });
        }
        await db.SaveChangesAsync();

        var handler = new SitemapGet(db);
        var page1 = Assert.IsType<ContentResult>(await handler.GetTunesSitemap(TestRequest.Anonymous()));
        var page2Req = TestRequest.Anonymous(query: new System.Collections.Generic.Dictionary<string, string> { ["page"] = "2" });
        var page2 = Assert.IsType<ContentResult>(await handler.GetTunesSitemap(page2Req));

        XNamespace ns = "http://www.sitemaps.org/schemas/sitemap/0.9";
        var doc1 = XDocument.Parse(page1.Content!);
        var doc2 = XDocument.Parse(page2.Content!);

        Assert.Equal(5000, doc1.Descendants(ns + "url").Count());
        Assert.Single(doc2.Descendants(ns + "url"));
        Assert.Empty(doc2.Descendants(ns + "lastmod"));
    }
}
