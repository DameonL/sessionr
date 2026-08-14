using System;
using System.Collections.Generic;
using System.Linq;

namespace SessionApp.Api.Services;

/// <summary>
/// Pure, dependency-free primitives for turning a melody's absolute MIDI note
/// sequence into a transposition-invariant "fingerprint" (a semitone interval
/// sequence) and scoring how well a live-captured snippet matches one, via
/// local alignment (Smith–Waterman). Used by <see cref="TuneHeuristics"/> to
/// compute each tune's stored fingerprint, and by <see cref="TuneMatchIndex"/>
/// to score a played snippet against every candidate.
///
/// Deliberately independent of the EF models — this is math over int arrays.
/// </summary>
public static class MelodyFingerprint
{
    /// <summary>
    /// A candidate is worth surfacing at all above this confidence (0-100).
    /// Below this, the tune is still returned (nothing is hidden server-side)
    /// but callers should treat the result as "no confident match".
    /// </summary>
    public const int ConfidenceThresholdPercent = 40;

    /// <summary>Consecutive interval tokens hashed together for candidate narrowing.</summary>
    private const int ShingleLength = 5;

    // Smith–Waterman scoring. An octave-off note (a known pitch-detector failure
    // mode — see pitchDetector.ts) gets partial credit rather than a full penalty.
    private const int ExactMatchScore = 2;
    private const int OctaveErrorScore = 1;
    private const int MismatchScore = -1;
    private const int GapScore = -1;

    /// <summary>
    /// Collapses immediately-repeated pitches (A,A,B -> A,B) and diffs the rest into
    /// signed semitone intervals. Repeat-collapsing matters because the live capture
    /// structurally cannot represent a sustained/re-attacked identical pitch (see
    /// pitchDetector.ts's firedMidi debounce) — both sides of a comparison must be
    /// built the same way for the intervals to line up.
    /// </summary>
    public static int[] ToIntervals(IReadOnlyList<int> midis)
    {
        if (midis.Count < 2) return [];

        var collapsed = new List<int>(midis.Count) { midis[0] };
        for (var i = 1; i < midis.Count; i++)
        {
            if (midis[i] != collapsed[^1]) collapsed.Add(midis[i]);
        }

        if (collapsed.Count < 2) return [];

        var intervals = new int[collapsed.Count - 1];
        for (var i = 0; i < intervals.Length; i++)
        {
            intervals[i] = collapsed[i + 1] - collapsed[i];
        }
        return intervals;
    }

    public static string ToIntervalString(IReadOnlyList<int> midis) =>
        string.Join(',', ToIntervals(midis));

    public static int[] ParseIntervalString(string? s) =>
        string.IsNullOrEmpty(s) ? [] : Array.ConvertAll(s.Split(','), int.Parse);

    /// <summary>Hashes every length-<see cref="ShingleLength"/> window of consecutive intervals.</summary>
    public static IEnumerable<long> Shingles(int[] intervals, int k = ShingleLength)
    {
        if (intervals.Length < k) yield break;
        for (var i = 0; i <= intervals.Length - k; i++)
        {
            long hash = 17;
            for (var j = 0; j < k; j++)
            {
                hash = hash * 31 + intervals[i + j];
            }
            yield return hash;
        }
    }

    public readonly record struct AlignmentResult(int Score, int MatchedLength);

    /// <summary>
    /// Best-scoring contiguous local alignment of <paramref name="query"/> against
    /// <paramref name="candidate"/> (Smith–Waterman). Local — not global — alignment
    /// is what makes this work for a short excerpt of a longer, possibly multi-part
    /// tune: the unmatched head/tail of the candidate isn't penalized.
    /// </summary>
    public static AlignmentResult LocalAlign(int[] query, int[] candidate)
    {
        if (query.Length == 0 || candidate.Length == 0) return new AlignmentResult(0, 0);

        var rows = query.Length + 1;
        var cols = candidate.Length + 1;
        var h = new int[rows, cols];
        // Length of the alignment ending at each cell, tracked alongside the score
        // so the winning cell's matched span can be reported without a full traceback.
        var len = new int[rows, cols];

        var bestScore = 0;
        var bestLen = 0;

        for (var i = 1; i < rows; i++)
        {
            for (var j = 1; j < cols; j++)
            {
                var delta = query[i - 1] - candidate[j - 1];
                var subScore = delta == 0 ? ExactMatchScore
                    : Math.Abs(delta) == 12 || Math.Abs(delta) == 24 ? OctaveErrorScore
                    : MismatchScore;

                var diag = h[i - 1, j - 1] + subScore;
                var up = h[i - 1, j] + GapScore;
                var left = h[i, j - 1] + GapScore;

                var best = Math.Max(0, Math.Max(diag, Math.Max(up, left)));
                h[i, j] = best;

                len[i, j] = best == 0 ? 0
                    : best == diag ? len[i - 1, j - 1] + 1
                    : best == up ? len[i - 1, j] + 1
                    : len[i, j - 1] + 1;

                if (best > bestScore)
                {
                    bestScore = best;
                    bestLen = len[i, j];
                }
            }
        }

        return new AlignmentResult(bestScore, bestLen);
    }

    /// <summary>
    /// Confidence (0-100) for an alignment of a query of the given length.
    /// Normalized against a hypothetical perfect self-match of the query, and
    /// discounted if the winning alignment covered too little of the query to
    /// be meaningful (avoids a short lucky peak inside a long noisy candidate
    /// scoring artificially high).
    /// </summary>
    public static double Confidence(AlignmentResult result, int queryLength)
    {
        if (queryLength == 0) return 0;

        const double minCoverage = 0.6;
        var coverage = (double)result.MatchedLength / queryLength;
        if (coverage < minCoverage) return 0;

        var perfectScore = queryLength * ExactMatchScore;
        var raw = perfectScore == 0 ? 0 : (double)result.Score / perfectScore;
        return Math.Clamp(raw, 0, 1) * 100;
    }
}
