using System;
using System.Collections.Generic;
using System.Linq;
using System.Security;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;

namespace SessionApp.Api.Functions.Sitemap;

public class Get(AppDbContext db)
{
    private const string SiteOrigin = "https://sessionr.org";
    private const string SitemapNamespace = "http://www.sitemaps.org/schemas/sitemap/0.9";
    private const int MaxUrlsPerSitemap = 5000;
    private const string SitemapCacheControl = "public, max-age=300, s-maxage=86400, stale-while-revalidate=86400";

    /// <summary>GET /api/sitemap.xml — sitemap index pointing to static, tune, group, and set sitemaps.</summary>
    [Function("GetSitemapIndex")]
    public async Task<IActionResult> GetSitemapIndex(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sitemap.xml")] HttpRequest req)
    {
        ApplySitemapCaching(req);

        // Materialize minimal or full tune count via LibraryStats or Tunes query.
        var tuneCount = await GetTuneCountAsync();
        var tunePages = Math.Max(1, (int)Math.Ceiling(tuneCount / (double)MaxUrlsPerSitemap));

        var sb = new StringBuilder();
        sb.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLine($"<sitemapindex xmlns=\"{SitemapNamespace}\">");
        sb.AppendLine($"  <sitemap><loc>{SiteOrigin}/sitemap-static.xml</loc></sitemap>");
        for (var page = 1; page <= tunePages; page++)
        {
            var suffix = tunePages == 1 && page == 1 ? "" : $"?page={page}";
            sb.AppendLine($"  <sitemap><loc>{SiteOrigin}/sitemap-tunes.xml{SecurityElement.Escape(suffix)}</loc></sitemap>");
        }
        sb.AppendLine($"  <sitemap><loc>{SiteOrigin}/sitemap-groups.xml</loc></sitemap>");
        sb.AppendLine($"  <sitemap><loc>{SiteOrigin}/sitemap-sets.xml</loc></sitemap>");
        sb.AppendLine("</sitemapindex>");

        return XmlResult(sb.ToString());
    }

    /// <summary>GET /api/sitemap-tunes.xml — all public tunes.</summary>
    [Function("GetTunesSitemap")]
    public async Task<IActionResult> GetTunesSitemap(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sitemap-tunes.xml")] HttpRequest req)
    {
        ApplySitemapCaching(req);

        int.TryParse(req.Query["page"], out var page);
        if (page < 1) page = 1;

        // Project only IDs and timestamps with nullable casts so schemaless Cosmos documents
        // missing CreatedAt/ReviewedAt fall back cleanly without pulling MasterAbcText or fingerprints.
        var tunes = await db.Tunes
            .AsNoTracking()
            .OrderBy(t => t.TuneId)
            .Skip((page - 1) * MaxUrlsPerSitemap)
            .Take(MaxUrlsPerSitemap)
            .Select(t => new
            {
                t.TuneId,
                ReviewedAt = (DateTime?)t.ReviewedAt,
                CreatedAt = (DateTime?)t.CreatedAt,
            })
            .ToListAsync();

        var entries = tunes.Select(t =>
        {
            var lastMod = t.ReviewedAt ?? (t.CreatedAt is { } created && created > DateTime.MinValue ? created : (DateTime?)null);
            return ($"{SiteOrigin}/tunes/{t.TuneId}", lastMod, "weekly", "0.7");
        });

        return XmlResult(BuildUrlSet(entries));
    }

    /// <summary>GET /api/sitemap-groups.xml — all public (non-private) session groups.</summary>
    [Function("GetGroupsSitemap")]
    public async Task<IActionResult> GetGroupsSitemap(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sitemap-groups.xml")] HttpRequest req)
    {
        ApplySitemapCaching(req);

        // Project scalar fields and filter !IsPrivate in C# for Cosmos schemaless safety, bounded to MaxUrlsPerSitemap.
        var groups = await db.Groups
            .AsNoTracking()
            .Where(g => !g.IsPrivate)
            .OrderBy(g => g.GroupId)
            .Take(MaxUrlsPerSitemap)
            .Select(g => new
            {
                g.GroupId,
                ReviewedAt = (DateTime?)g.ReviewedAt,
                CreatedAt = (DateTime?)g.CreatedAt,
            })
            .ToListAsync();

        var entries = groups
            .Select(g =>
            {
                var lastMod = g.ReviewedAt ?? (g.CreatedAt is { } created && created > DateTime.MinValue ? created : (DateTime?)null);
                return ($"{SiteOrigin}/group/{g.GroupId}", lastMod, "weekly", "0.7");
            });

        return XmlResult(BuildUrlSet(entries));
    }

    /// <summary>
    /// GET /api/sitemap-sets.xml — all publicly readable tune sets (owned by non-private users).
    /// User profiles themselves are intentionally excluded from sitemaps.
    /// </summary>
    [Function("GetSetsSitemap")]
    public async Task<IActionResult> GetSetsSitemap(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sitemap-sets.xml")] HttpRequest req)
    {
        ApplySitemapCaching(req);

        var sets = await db.Sets
            .AsNoTracking()
            .OrderBy(s => s.SetId)
            .Take(MaxUrlsPerSitemap)
            .Select(s => new { s.SetId, s.UserId })
            .ToListAsync();

        if (sets.Count == 0)
        {
            return XmlResult(BuildUrlSet(Array.Empty<(string, DateTime?, string, string)>()));
        }

        var ownerIds = sets.Select(s => s.UserId).Distinct().ToList();
        var publicOwnerIds = new HashSet<Guid>();
        foreach (var chunk in ownerIds.Chunk(100))
        {
            var chunkIds = chunk.ToList();
            var owners = await db.Users
                .AsNoTracking()
                .Where(u => chunkIds.Contains(u.UserId))
                .Select(u => new { u.UserId, IsProfilePrivate = (bool?)u.IsProfilePrivate })
                .ToListAsync();

            foreach (var u in owners)
            {
                if (u.IsProfilePrivate != true)
                {
                    publicOwnerIds.Add(u.UserId);
                }
            }
        }

        var entries = sets
            .Where(s => publicOwnerIds.Contains(s.UserId))
            .Select(s => ($"{SiteOrigin}/set/{s.SetId}", (DateTime?)null, "monthly", "0.5"));

        return XmlResult(BuildUrlSet(entries));
    }

    private async Task<int> GetTuneCountAsync()
    {
        try
        {
            var stats = await db.LibraryStats
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.LibraryStatsId == Models.LibraryStats.SingletonId);
            if (stats is not null && stats.TuneCount > 0)
            {
                return stats.TuneCount;
            }
        }
        catch
        {
            // Fall through to live count if LibraryStats is unavailable.
        }

        return await db.Tunes.Select(t => t.TuneId).CosmosCountAsync();
    }

    private static void ApplySitemapCaching(HttpRequest req)
    {
        if (req?.HttpContext?.Response?.Headers is not null)
        {
            req.HttpContext.Response.Headers["Cache-Control"] = SitemapCacheControl;
        }
    }

    private static string BuildUrlSet(IEnumerable<(string Loc, DateTime? LastMod, string ChangeFreq, string Priority)> urls)
    {
        var sb = new StringBuilder();
        sb.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLine($"<urlset xmlns=\"{SitemapNamespace}\">");
        foreach (var (loc, lastMod, changeFreq, priority) in urls)
        {
            sb.AppendLine("  <url>");
            sb.AppendLine($"    <loc>{SecurityElement.Escape(loc)}</loc>");
            if (lastMod.HasValue)
            {
                sb.AppendLine($"    <lastmod>{lastMod.Value.ToUniversalTime():yyyy-MM-dd}</lastmod>");
            }
            sb.AppendLine($"    <changefreq>{changeFreq}</changefreq>");
            sb.AppendLine($"    <priority>{priority}</priority>");
            sb.AppendLine("  </url>");
        }
        sb.AppendLine("</urlset>");
        return sb.ToString();
    }

    private static ContentResult XmlResult(string xml) =>
        new()
        {
            Content = xml,
            ContentType = "application/xml; charset=utf-8",
            StatusCode = StatusCodes.Status200OK,
        };
}
