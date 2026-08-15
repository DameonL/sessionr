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

    /// <summary>
    /// A query shorter than this (in intervals) can't produce a meaningful
    /// confidence at all, regardless of coverage: a 1-interval query trivially
    /// clears any coverage ratio by matching one coincidental interval
    /// anywhere in a candidate — near-certain for a common interval against a
    /// 50-150 note fingerprint — which without this floor produced a spurious
    /// 100% "match" from as little as two arbitrary notes.
    /// </summary>
    private const int MinQueryLength = 4;

    /// <summary>Consecutive interval tokens hashed together for candidate narrowing.</summary>
    private const int ShingleLength = 5;

    // Smith-Waterman scoring, in doubled integer units so the affine gap costs
    // below (which include a half-point extend cost) stay exact integers. An
    // octave-off note (a known pitch-detector failure mode — see
    // pitchDetector.ts) gets partial credit rather than a full penalty.
    private const int ExactMatchScore = 4;
    private const int OctaveErrorScore = 2;
    private const int MismatchScore = -2;

    // Affine gap costs (Gotoh's algorithm): opening a gap costs more than
    // continuing one already open, so a burst of several consecutive noise
    // notes — the common failure mode in a loud, busy session — is charged
    // once for the burst rather than once per note. In real (halved) units
    // this is gapOpen=-2, gapExtend=-0.5, versus a flat -1/note before.
    private const int GapOpenScore = -4;
    private const int GapExtendScore = -1;

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
    /// <paramref name="candidate"/> (Smith–Waterman with affine gap costs, via
    /// Gotoh's three-matrix formulation). Local — not global — alignment is what
    /// makes this work for a short excerpt of a longer, possibly multi-part tune:
    /// the unmatched head/tail of the candidate isn't penalized.
    /// </summary>
    public static AlignmentResult LocalAlign(int[] query, int[] candidate)
    {
        if (query.Length == 0 || candidate.Length == 0) return new AlignmentResult(0, 0);

        var rows = query.Length + 1;
        var cols = candidate.Length + 1;

        // H = best score ending in a match/mismatch (or a fresh restart at 0).
        // E = best score ending in a gap against the candidate (query note with
        //     no counterpart yet); F = best score ending in a gap against the
        //     query (candidate note with no counterpart yet).
        var h = new int[rows, cols];
        var e = new int[rows, cols];
        var f = new int[rows, cols];
        // Length of the alignment ending at each cell for each matrix, tracked
        // alongside the score so the winning cell's matched span can be
        // reported without a full traceback.
        var hLen = new int[rows, cols];
        var eLen = new int[rows, cols];
        var fLen = new int[rows, cols];

        // Row/col 0 represent "no notes consumed yet" — a gap can't already be
        // open there, so extending from it must never look cheaper than opening
        // a fresh one.
        const int negInf = int.MinValue / 4;
        for (var j = 0; j < cols; j++) e[0, j] = negInf;
        for (var i = 0; i < rows; i++) f[i, 0] = negInf;

        var bestScore = 0;
        var bestLen = 0;

        for (var i = 1; i < rows; i++)
        {
            for (var j = 1; j < cols; j++)
            {
                var eOpen = h[i - 1, j] + GapOpenScore;
                var eExtend = e[i - 1, j] + GapExtendScore;
                if (eOpen >= eExtend)
                {
                    e[i, j] = eOpen;
                    eLen[i, j] = hLen[i - 1, j] + 1;
                }
                else
                {
                    e[i, j] = eExtend;
                    eLen[i, j] = eLen[i - 1, j] + 1;
                }

                var fOpen = h[i, j - 1] + GapOpenScore;
                var fExtend = f[i, j - 1] + GapExtendScore;
                if (fOpen >= fExtend)
                {
                    f[i, j] = fOpen;
                    fLen[i, j] = hLen[i, j - 1] + 1;
                }
                else
                {
                    f[i, j] = fExtend;
                    fLen[i, j] = fLen[i, j - 1] + 1;
                }

                var delta = query[i - 1] - candidate[j - 1];
                var subScore = delta == 0 ? ExactMatchScore
                    : Math.Abs(delta) == 12 || Math.Abs(delta) == 24 ? OctaveErrorScore
                    : MismatchScore;
                var diag = h[i - 1, j - 1] + subScore;

                var best = 0;
                var bestCellLen = 0;
                if (diag > best) { best = diag; bestCellLen = hLen[i - 1, j - 1] + 1; }
                if (e[i, j] > best) { best = e[i, j]; bestCellLen = eLen[i, j]; }
                if (f[i, j] > best) { best = f[i, j]; bestCellLen = fLen[i, j]; }

                h[i, j] = best;
                hLen[i, j] = best == 0 ? 0 : bestCellLen;

                if (best > bestScore)
                {
                    bestScore = best;
                    bestLen = bestCellLen;
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
        if (queryLength < MinQueryLength) return 0;

        // Raised from 0.6: a noisier session query needs more of itself to
        // actually land in the winning alignment before a peak is trusted,
        // without going so high it fights local alignment's own tolerance
        // for a genuinely partial excerpt.
        const double minCoverage = 0.65;
        var coverage = (double)result.MatchedLength / queryLength;
        if (coverage < minCoverage) return 0;

        var perfectScore = queryLength * ExactMatchScore;
        var raw = perfectScore == 0 ? 0 : (double)result.Score / perfectScore;
        return Math.Clamp(raw, 0, 1) * 100;
    }
}
