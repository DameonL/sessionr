using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Functions;

public record TheSessionSearchResultDto(int TheSessionId, string Name, string Type);

public record ImportRequest(int TheSessionId);

public record TunebookImportRequest(int UserId, int MemberId);

public record TunebookImportResultDto(
    int TotalFound,
    int Imported,
    int AddedToRepertoire,
    int AlreadyInRepertoire,
    List<string> Failures);

/// <summary>
/// Server-side proxy for importing tunes from thesession.org's public JSON API
/// (keeps CORS and the external dependency out of the browser).
/// </summary>
public class ImportFunctions(AppDbContext db, IHttpClientFactory httpClientFactory, ILogger<ImportFunctions> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    // thesession.org rhythm names -> our enum and conventional meters.
    private static readonly Dictionary<string, (TuneType Type, string Meter)> TypeMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["reel"] = (TuneType.Reel, "4/4"),
        ["jig"] = (TuneType.Jig, "6/8"),
        ["slip jig"] = (TuneType.SlipJig, "9/8"),
        ["hornpipe"] = (TuneType.Hornpipe, "4/4"),
        ["polka"] = (TuneType.Polka, "2/4"),
        ["slide"] = (TuneType.Slide, "12/8"),
        ["waltz"] = (TuneType.Waltz, "3/4"),
        ["barndance"] = (TuneType.Barndance, "4/4"),
        ["strathspey"] = (TuneType.Strathspey, "4/4"),
        ["mazurka"] = (TuneType.Mazurka, "3/4"),
        ["march"] = (TuneType.March, "4/4"),
        ["three-two"] = (TuneType.Other, "3/2"),
    };

    /// <summary>GET /api/import/thesession/search?q= — search thesession.org.</summary>
    [Function("SearchTheSession")]
    public async Task<IActionResult> SearchTheSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "import/thesession/search")] HttpRequest req)
    {
        var q = req.Query["q"].ToString();
        if (string.IsNullOrWhiteSpace(q))
        {
            return new BadRequestObjectResult("q is required.");
        }

        using var client = CreateClient();
        TheSessionSearchResponse? response;
        try
        {
            response = await client.GetFromJsonAsync<TheSessionSearchResponse>(
                $"https://thesession.org/tunes/search?q={Uri.EscapeDataString(q)}&format=json", JsonOptions);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "thesession.org search failed");
            return new ObjectResult("thesession.org is unreachable.") { StatusCode = StatusCodes.Status502BadGateway };
        }

        var results = (response?.Tunes ?? [])
            .Take(10)
            .Select(t => new TheSessionSearchResultDto(t.Id, t.Name, t.Type))
            .ToList();

        return new OkObjectResult(results);
    }

    /// <summary>
    /// POST /api/import/thesession — import a tune's first setting into the
    /// global library (or return the already-imported tune).
    /// </summary>
    [Function("ImportFromTheSession")]
    public async Task<IActionResult> ImportFromTheSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "import/thesession")] HttpRequest req)
    {
        var body = await req.ReadFromJsonAsync<ImportRequest>();
        if (body is null || body.TheSessionId <= 0)
        {
            return new BadRequestObjectResult("TheSessionId is required.");
        }

        using var client = CreateClient();
        TheSessionTuneDetail? detail;
        try
        {
            detail = await client.GetFromJsonAsync<TheSessionTuneDetail>(
                $"https://thesession.org/tunes/{body.TheSessionId}?format=json", JsonOptions);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "thesession.org tune fetch failed for {Id}", body.TheSessionId);
            return new ObjectResult("thesession.org is unreachable.") { StatusCode = StatusCodes.Status502BadGateway };
        }

        var tune = await UpsertTuneFromDetail(detail);
        if (tune is null)
        {
            return new NotFoundObjectResult("Tune or its notation was not found on thesession.org.");
        }

        logger.LogInformation("Imported thesession.org tune {Id} as '{Title}'", body.TheSessionId, tune.Title);

        return new OkObjectResult(new TuneDto(tune.TuneId, tune.Title, tune.TuneType.ToString(), tune.Key));
    }

    /// <summary>
    /// POST /api/import/thesession/tunebook — bulk-import a member's whole
    /// tunebook by member ID into the library and the user's repertoire.
    /// </summary>
    [Function("ImportTunebook")]
    public async Task<IActionResult> ImportTunebook(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "import/thesession/tunebook")] HttpRequest req)
    {
        const int maxTunes = 200;

        var body = await req.ReadFromJsonAsync<TunebookImportRequest>();
        if (body is null || body.MemberId <= 0)
        {
            return new BadRequestObjectResult("MemberId is required and must be a positive integer.");
        }
        var memberId = body.MemberId.ToString();

        using var client = CreateClient();

        // Page through the tunebook listing first.
        var entries = new List<TheSessionSearchTune>();
        try
        {
            for (var page = 1; entries.Count < maxTunes; page++)
            {
                var listing = await client.GetFromJsonAsync<TheSessionTunebookResponse>(
                    $"https://thesession.org/members/{memberId}/tunebook?format=json&page={page}", JsonOptions);
                if (listing?.Tunes is null || listing.Tunes.Count == 0)
                {
                    break;
                }
                entries.AddRange(listing.Tunes);
                if (page >= listing.Pages)
                {
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "thesession.org tunebook listing failed for member {MemberId}", memberId);
            return new ObjectResult("thesession.org is unreachable.") { StatusCode = StatusCodes.Status502BadGateway };
        }

        var result = new TunebookImportResultDto(entries.Count, 0, 0, 0, []);
        var imported = 0;
        var added = 0;
        var already = 0;

        foreach (var entry in entries.Take(maxTunes))
        {
            try
            {
                var detail = await client.GetFromJsonAsync<TheSessionTuneDetail>(
                    $"https://thesession.org/tunes/{entry.Id}?format=json", JsonOptions);
                var tune = await UpsertTuneFromDetail(detail);
                if (tune is null)
                {
                    result.Failures.Add($"{entry.Name}: no notation found");
                    continue;
                }
                imported++;

                var inRepertoire = await db.UserTunes.AnyAsync(
                    ut => ut.UserId == body.UserId && ut.TuneId == tune.TuneId);
                if (inRepertoire)
                {
                    already++;
                }
                else
                {
                    db.UserTunes.Add(new UserTune
                    {
                        UserId = body.UserId,
                        TuneId = tune.TuneId,
                        Status = TuneStatus.Learning,
                        TargetBpm = Tune.GetDefaultTargetBpm(tune.TuneType),
                    });
                    await db.SaveChangesAsync();
                    added++;
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Tunebook import failed for tune {Id}", entry.Id);
                result.Failures.Add($"{entry.Name}: fetch failed");
            }
        }

        logger.LogInformation(
            "Tunebook import for member {MemberId}: {Found} found, {Imported} imported, {Added} added",
            memberId, entries.Count, imported, added);

        return new OkObjectResult(result with
        {
            Imported = imported,
            AddedToRepertoire = added,
            AlreadyInRepertoire = already,
        });
    }

    /// <summary>Creates the tune from a thesession.org detail payload, or returns the existing one.</summary>
    private async Task<Tune?> UpsertTuneFromDetail(TheSessionTuneDetail? detail)
    {
        var setting = detail?.Settings?.FirstOrDefault();
        if (detail is null || setting is null || string.IsNullOrWhiteSpace(setting.Abc))
        {
            return null;
        }

        var key = NormalizeKey(setting.Key);
        var (tuneType, meter) = TypeMap.GetValueOrDefault(detail.Type ?? "", (TuneType.Other, "4/4"));

        var title = detail.Name!.Trim();
        var existing = await db.Tunes.FirstOrDefaultAsync(
            t => t.Title.ToLower() == title.ToLower() && t.Key == key);
        if (existing is not null)
        {
            return existing;
        }

        var tune = new Tune
        {
            Title = title,
            TuneType = tuneType,
            Key = key,
            MasterAbcText = BuildAbc(title, detail.Type ?? "", meter, key, setting.Abc),
        };
        db.Tunes.Add(tune);
        await db.SaveChangesAsync();
        return tune;
    }

    private HttpClient CreateClient()
    {
        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(10);
        client.DefaultRequestHeaders.UserAgent.ParseAdd("SessionApp/0.1 (trad repertoire manager)");
        return client;
    }

    /// <summary>thesession.org keys like "Dmajor"/"Edorian"/"Aminor" -> ABC form "D"/"Edor"/"Am".</summary>
    private static string NormalizeKey(string? key)
    {
        if (string.IsNullOrWhiteSpace(key))
        {
            return "";
        }

        (string Suffix, string Abc)[] modes =
        [
            ("major", ""), ("minor", "m"), ("dorian", "dor"),
            ("mixolydian", "mix"), ("phrygian", "phr"), ("lydian", "lyd"),
        ];
        foreach (var (suffix, abc) in modes)
        {
            if (key.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
            {
                return key[..^suffix.Length] + abc;
            }
        }
        return key;
    }

    /// <summary>
    /// thesession.org settings are body-only with "!" as line separators;
    /// synthesize a complete ABC tune around them.
    /// </summary>
    private static string BuildAbc(string title, string rhythm, string meter, string key, string abcBody)
    {
        var body = abcBody.Replace("!", "\n").Trim();
        return $"X:1\nT:{title}\nR:{rhythm}\nM:{meter}\nL:1/8\nK:{key}\n{body}";
    }

    // Minimal shapes of thesession.org's JSON responses.
    private sealed record TheSessionSearchResponse(List<TheSessionSearchTune> Tunes);
    private sealed record TheSessionTunebookResponse(int Pages, List<TheSessionSearchTune>? Tunes);
    private sealed record TheSessionSearchTune(int Id, string Name, string Type);
    private sealed record TheSessionTuneDetail(string? Name, string? Type, List<TheSessionSetting>? Settings);
    private sealed record TheSessionSetting(string? Key, string? Abc);
}
