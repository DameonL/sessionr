using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using SessionApp.Api.Data;
using SessionApp.Api.Models;

namespace SessionApp.Api.Services;

// Minimal shapes of thesession.org's JSON responses.
public sealed record TheSessionSearchResponse(List<TheSessionSearchTune> Tunes);
public sealed record TheSessionTunebookResponse(int Pages, List<TheSessionSearchTune>? Tunes);
public sealed record TheSessionSearchTune(int Id, string Name, string Type);
public sealed record TheSessionTuneDetail(int Id, string? Name, string? Type, List<TheSessionSetting>? Settings);
public sealed record TheSessionSetting(string? Key, string? Abc);

/// <summary>
/// Shared client for thesession.org's public JSON API, plus the tune-upsert logic
/// used by both the public search/import endpoints and the private tunebook import.
/// </summary>
public class TheSessionImportService(AppDbContext db, IHttpClientFactory httpClientFactory)
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

    public async Task<List<TheSessionSearchTune>> SearchAsync(string q)
    {
        using var client = CreateClient();
        var response = await client.GetFromJsonAsync<TheSessionSearchResponse>(
            $"https://thesession.org/tunes/search?q={Uri.EscapeDataString(q)}&format=json", JsonOptions);
        return response?.Tunes ?? [];
    }

    public async Task<TheSessionTuneDetail?> GetTuneDetailAsync(int theSessionId)
    {
        using var client = CreateClient();
        return await client.GetFromJsonAsync<TheSessionTuneDetail>(
            $"https://thesession.org/tunes/{theSessionId}?format=json", JsonOptions);
    }

    /// <summary>Pages through a member's tunebook listing, up to maxTunes entries.</summary>
    public async Task<List<TheSessionSearchTune>> GetTunebookAsync(string memberId, int maxTunes)
    {
        using var client = CreateClient();
        var entries = new List<TheSessionSearchTune>();
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
        return entries;
    }

    /// <summary>Creates the tune from a thesession.org detail payload, or returns the existing one.</summary>
    public async Task<Tune?> UpsertTuneFromDetailAsync(TheSessionTuneDetail? detail)
    {
        var setting = detail?.Settings?.FirstOrDefault();
        if (detail is null || setting is null || string.IsNullOrWhiteSpace(setting.Abc))
        {
            return null;
        }

        var key = NormalizeKey(setting.Key);
        var (tuneType, meter) = TypeMap.GetValueOrDefault(detail.Type ?? "", (TuneType.Other, "4/4"));

        var title = detail.Name!.Trim();
        var existing = await db.Tunes.FirstOrDefaultAsync(t => t.TheSessionId == detail.Id);
        if (existing is null)
        {
            existing = await db.Tunes.FirstOrDefaultAsync(
                t => t.Title.ToLower() == title.ToLower() && t.Key == key && (t.TheSessionId == null || t.TheSessionId == detail.Id));
        }

        if (existing is not null)
        {
            var correctAbc = BuildAbc(title, detail.Type ?? "", meter, key, setting.Abc);
            if (existing.TheSessionId != detail.Id || existing.MasterAbcText != correctAbc)
            {
                existing.TheSessionId = detail.Id;
                existing.MasterAbcText = correctAbc;
                await db.SaveChangesAsync();
            }
            return existing;
        }

        var tune = new Tune
        {
            Title = title,
            TheSessionId = detail.Id,
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
}
