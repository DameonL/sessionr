using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using SessionApp.Api.Services;

namespace SessionApp.Api.Functions.Tunes;

public class Match(TuneMatchIndex matchIndex)
{
    // Only a sanity floor for a genuinely empty/near-empty submission (need at
    // least 2 notes to form a single interval at all) — anything more is left
    // to the matcher's own confidence scoring rather than a hard block here.
    // A sparse-but-real capture should degrade to a low-confidence result,
    // not an error; a prior higher value here rejected legitimate attempts
    // whenever the classifier under-captured a real performance. Spurious
    // high-confidence "matches" from a too-short query are guarded against
    // in MelodyFingerprint.Confidence's own MinQueryLength floor, not here.
    private const int MinNotes = 2;
    private const int MaxNotes = 300;
    private const int MinMidi = 40; // ~E2, below typical session-instrument range
    private const int MaxMidi = 96; // ~C7, above typical session-instrument range
    private const int TopN = 5;

    /// <summary>
    /// POST /api/tunes/match — identifies which tune(s) a live-played snippet is likely
    /// to be. The client streams stable MIDI notes from the mic (pitchDetector.ts) and
    /// posts the captured ordered sequence; matching runs entirely in-memory against a
    /// precomputed fingerprint index (see TuneMatchIndex), no per-request DB query.
    /// </summary>
    [Function("MatchTune")]
    public async Task<IActionResult> MatchTune(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "tunes/match")] HttpRequest req)
    {
        TuneMatchRequest? body;
        try
        {
            body = await req.ReadFromJsonAsync<TuneMatchRequest>();
        }
        catch (System.Text.Json.JsonException)
        {
            return new BadRequestObjectResult("Invalid JSON payload.");
        }

        if (body?.Notes is null || body.Notes.Count < MinNotes)
        {
            return new BadRequestObjectResult($"Play at least {MinNotes} notes before identifying.");
        }

        var notes = body.Notes
            .Where(m => m >= MinMidi && m <= MaxMidi)
            .Take(MaxNotes)
            .ToList();

        if (notes.Count < MinNotes)
        {
            return new BadRequestObjectResult($"Play at least {MinNotes} notes before identifying.");
        }

        var queryIntervals = MelodyFingerprint.ToIntervals(notes);
        var candidates = await matchIndex.MatchAsync(queryIntervals, TopN, req.HttpContext.RequestAborted);

        var hasConfidentMatch = candidates.Count > 0 && candidates[0].Confidence >= MelodyFingerprint.ConfidenceThresholdPercent;
        return new OkObjectResult(new TuneMatchResponse(candidates.ToList(), hasConfidentMatch));
    }
}
