using System;
using System.Collections.Generic;
using System.Globalization;
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

    // A semitone out is the one wrong interval worth forgiving rather than punishing: it is
    // what a modal difference between two settings looks like (a C natural against a C sharp)
    // and also what the pitch detector's own jitter produces at a note boundary. Small on
    // purpose — enough that a near miss doesn't cost the same as an unrelated note, not enough
    // to make being a semitone wrong a cheap way to match. Measured on real recordings, +1
    // lifted every target; +2 started lifting the decoys with them.
    private const int NearMissScore = 1;

    // Affine gap costs (Gotoh's algorithm): opening a gap costs more than
    // continuing one already open, so a burst of several consecutive noise
    // notes — the common failure mode in a loud, busy session — is charged
    // once for the burst rather than once per note. In real (halved) units
    // this is gapOpen=-2, gapExtend=-0.5, versus a flat -1/note before.
    private const int GapOpenScore = -4;
    private const int GapExtendScore = -1;

    // A live-played query legitimately contains notes with no fingerprint
    // counterpart at all: rolls/cuts/trebles are full, articulated notes in
    // a recording even though TuneHeuristics strips ABC grace notes from the
    // stored fingerprint. Up to this many consecutive query intervals can
    // consolidate into a single step (see LocalAlign) when their signed sum
    // still lands on the candidate's next interval, so an ornament scores
    // like a clean match instead of paying a gap penalty per inserted note.
    private const int OrnamentConsolidationMax = 3;

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

    /// <summary>
    /// Repeats a candidate's intervals until it is at least <paramref name="minLength"/> long.
    ///
    /// A ~20 second sample of someone playing covers more than one pass of a short tune, so the
    /// query is routinely *longer* than the stored fingerprint (measured: 127 query intervals
    /// against a 113-interval reel). <see cref="Confidence"/> normalises by query length, so
    /// whatever the candidate cannot reach is unalignable and caps the score no matter how well
    /// the tune was played — and the coverage floor can zero the correct answer outright. Players
    /// cycle a tune several times through; the fingerprint it is compared against should too.
    ///
    /// The junction between repeats is left as a plain concatenation: the interval from the
    /// tune's last note back to its first is not knowable from the interval sequence alone, and
    /// one wrong interval per lap is comfortably absorbed by local alignment's affine gaps.
    /// </summary>
    public static int[] TileToAtLeast(int[] intervals, int minLength)
    {
        if (intervals.Length == 0 || intervals.Length >= minLength) return intervals;

        var laps = (int)Math.Ceiling((double)minLength / intervals.Length);
        var tiled = new int[intervals.Length * laps];
        for (var lap = 0; lap < laps; lap++)
        {
            Array.Copy(intervals, 0, tiled, lap * intervals.Length, intervals.Length);
        }
        return tiled;
    }

    /// <summary>
    /// Parses a stored fingerprint back into intervals, skipping anything unparseable.
    /// Deliberately lenient: this runs over every row when TuneMatchIndex rebuilds, so one
    /// malformed legacy value (a stray trailing comma, a whitespace-only string) must degrade
    /// to "that tune isn't in the index" rather than throwing and leaving there to be no index.
    /// </summary>
    public static int[] ParseIntervalString(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return [];

        var parts = s.Split(',');
        var parsed = new List<int>(parts.Length);
        foreach (var part in parts)
        {
            if (int.TryParse(part.Trim(), out var value))
            {
                parsed.Add(value);
            }
        }
        return parsed.ToArray();
    }

    /// <summary>Side length of the pitch-class transition matrix, and its flattened size.</summary>
    private const int PitchClasses = 12;
    private const int ProfileCells = PitchClasses * PitchClasses;

    /// <summary>
    /// How often each ordered pair of consecutive pitch classes occurs, as a flattened 12x12
    /// unit vector indexed <c>from * 12 + to</c>.
    ///
    /// This is deliberately *not* derivable from the interval fingerprint — collapsing a melody
    /// to intervals discards absolute pitch, which is the whole point of that representation but
    /// also throws away the tune's key/mode colour.
    ///
    /// Transitions rather than a plain histogram of note usage, because a histogram only
    /// describes a tune's note *inventory*, and a library is full of tunes that share one: two
    /// reels in D use the same seven notes in roughly the same proportions. Measured on the
    /// sample recordings, a histogram ranked one of them second behind a decoy it was separated
    /// from by 0.001 — a coin-flip — while this form ranked every recording first and roughly
    /// doubled the spread between the correct tune and the field, because it describes how the
    /// melody *moves* rather than what it is built from.
    /// </summary>
    public static double[] ToPitchClassProfile(IReadOnlyList<int> midis)
    {
        var counts = new double[ProfileCells];
        for (var i = 1; i < midis.Count; i++)
        {
            var from = ((midis[i - 1] % PitchClasses) + PitchClasses) % PitchClasses;
            var to = ((midis[i] % PitchClasses) + PitchClasses) % PitchClasses;
            counts[from * PitchClasses + to]++;
        }

        var norm = 0.0;
        foreach (var c in counts) norm += c * c;
        norm = Math.Sqrt(norm);
        if (norm == 0) return counts;

        for (var i = 0; i < ProfileCells; i++) counts[i] /= norm;
        return counts;
    }

    /// <summary>
    /// Serializes a profile as <c>index:value</c> pairs for the non-zero cells only. Most of the
    /// 144 cells are empty for any real tune — a melody only ever uses a handful of the possible
    /// transitions — so a sparse form keeps these rows close to the size of the plain histogram
    /// they replace, which matters because the match index materializes every row on rebuild.
    /// </summary>
    public static string ToPitchClassProfileString(IReadOnlyList<int> midis)
    {
        var profile = ToPitchClassProfile(midis);
        return string.Join(',', Enumerable.Range(0, ProfileCells)
            .Where(i => profile[i] > 0)
            .Select(i => $"{i}:{profile[i].ToString("0.#####", CultureInfo.InvariantCulture)}"));
    }

    /// <summary>
    /// Parses a stored profile, returning null if it isn't usable. Lenient for the same reason as
    /// <see cref="ParseIntervalString"/>: this runs over every row when the index rebuilds, so a
    /// malformed legacy value — including a profile written in the previous 12-value format —
    /// must cost that row alone and leave it scoring on alignment only.
    /// </summary>
    public static double[]? ParsePitchClassProfile(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;

        var parsed = new double[ProfileCells];
        var any = false;
        foreach (var part in s.Split(','))
        {
            var separator = part.IndexOf(':');
            if (separator <= 0) return null;

            if (!int.TryParse(part[..separator].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var index)
                || index < 0 || index >= ProfileCells)
            {
                return null;
            }
            if (!double.TryParse(part[(separator + 1)..].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
            {
                return null;
            }
            parsed[index] = value;
            any = true;
        }
        return any ? parsed : null;
    }

    /// <summary>
    /// Cosine similarity (0-1) between two pitch-class transition profiles, maximised over all
    /// twelve transpositions.
    ///
    /// Rotating both axes together is what keeps this transposition-invariant, matching the
    /// interval fingerprint's existing guarantee. Comparing profiles in place instead is
    /// measurably better when the player is in the tune's usual key and measurably worse
    /// otherwise — a query transposed by three semitones dropped every test recording back below
    /// the surfacing threshold, while this form scored identically either way.
    /// </summary>
    public static double PitchClassSimilarity(double[] query, double[] candidate)
    {
        if (query.Length != ProfileCells || candidate.Length != ProfileCells) return 0;

        var best = 0.0;
        for (var rotation = 0; rotation < PitchClasses; rotation++)
        {
            var dot = 0.0;
            for (var from = 0; from < PitchClasses; from++)
            {
                for (var to = 0; to < PitchClasses; to++)
                {
                    var rotated = ((from + rotation) % PitchClasses) * PitchClasses + (to + rotation) % PitchClasses;
                    dot += query[from * PitchClasses + to] * candidate[rotated];
                }
            }
            if (dot > best) best = dot;
        }
        return best;
    }

    /// <summary>
    /// Share of the final score contributed by pitch-class similarity rather than by melodic
    /// alignment. Alignment stays dominant deliberately: the profile is a coarse signal that
    /// says "this is the right key and mode colour", which many tunes in a library share, so
    /// it is here to break ties and lift a correct-but-noisy alignment over the threshold, not
    /// to identify a tune on its own.
    /// </summary>
    private const double PitchClassWeight = 0.3;

    /// <summary>
    /// Pitch-class similarity below this counts for nothing, and the range above it is rescaled
    /// onto 0-100.
    ///
    /// Set from where unrelated tunes actually land rather than fitted to an outcome: measured
    /// against the sample recordings, the mean similarity of every *wrong* tune fell between
    /// 0.47 and 0.56, so a floor here makes a typical decoy contribute nothing and only a
    /// genuinely similar profile score at all. Raising it trades absolute confidence for margin.
    /// </summary>
    private const double PitchClassFloor = 0.5;

    /// <summary>
    /// Blends the melodic alignment confidence (0-100) with pitch-class similarity. Falls back
    /// to alignment alone when a candidate has no stored profile, so a library that hasn't been
    /// backfilled yet degrades to the previous behaviour rather than scoring everything as zero.
    /// </summary>
    public static double FusedConfidence(double alignmentConfidence, double[]? query, double[]? candidate)
    {
        if (query is null || candidate is null) return alignmentConfidence;

        var similarity = PitchClassSimilarity(query, candidate);
        var scaled = Math.Clamp((similarity - PitchClassFloor) / (1 - PitchClassFloor), 0, 1) * 100;
        return alignmentConfidence * (1 - PitchClassWeight) + scaled * PitchClassWeight;
    }

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

                var delta = Math.Abs(query[i - 1] - candidate[j - 1]);
                var subScore = delta == 0 ? ExactMatchScore
                    : delta == 12 || delta == 24 ? OctaveErrorScore
                    : delta == 1 ? NearMissScore
                    : MismatchScore;
                var diag = h[i - 1, j - 1] + subScore;

                var best = 0;
                var bestCellLen = 0;
                if (diag > best) { best = diag; bestCellLen = hLen[i - 1, j - 1] + 1; }
                if (e[i, j] > best) { best = e[i, j]; bestCellLen = eLen[i, j]; }
                if (f[i, j] > best) { best = f[i, j]; bestCellLen = fLen[i, j]; }

                // Ornament consolidation: k consecutive query notes (an
                // articulated roll/cut/treble with no fingerprint counterpart)
                // collapsing into the single candidate interval at j, scored
                // like a normal match/octave step instead of k gap penalties.
                var ornamentSum = query[i - 1];
                for (var k = 2; k <= OrnamentConsolidationMax && i - k >= 0; k++)
                {
                    ornamentSum += query[i - k];
                    var ornamentDelta = ornamentSum - candidate[j - 1];
                    var ornamentScore = ornamentDelta == 0 ? ExactMatchScore
                        : Math.Abs(ornamentDelta) == 12 || Math.Abs(ornamentDelta) == 24 ? OctaveErrorScore
                        : (int?)null;
                    if (ornamentScore is null) continue;

                    var ornamentVal = h[i - k, j - 1] + ornamentScore.Value;
                    if (ornamentVal > best) { best = ornamentVal; bestCellLen = hLen[i - k, j - 1] + k; }
                }

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
