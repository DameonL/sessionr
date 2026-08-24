using SessionApp.Api.Services;

namespace SessionApp.Api.UnitTests.Services;

public class MelodyFingerprintTests
{
    [Fact]
    public void ToIntervals_DiffsConsecutivePitches()
    {
        Assert.Equal([2, 2, 1], MelodyFingerprint.ToIntervals([60, 62, 64, 65]));
    }

    [Fact]
    public void ToIntervals_IsTranspositionInvariant()
    {
        var inC = MelodyFingerprint.ToIntervals([60, 64, 67, 64]);
        var upAFifth = MelodyFingerprint.ToIntervals([67, 71, 74, 71]);

        Assert.Equal(inC, upAFifth);
    }

    [Fact]
    public void ToIntervals_CollapsesImmediatelyRepeatedPitches()
    {
        // The live capture cannot represent a re-attacked identical pitch (see the
        // pitchDetector debounce), so both sides must collapse repeats the same way.
        Assert.Equal([2, 2], MelodyFingerprint.ToIntervals([60, 60, 60, 62, 64]));
    }

    [Fact]
    public void ToIntervals_CollapsesOnlyAdjacentRepeats()
    {
        // 60,62,60 is a genuine there-and-back, not a repeat.
        Assert.Equal([2, -2], MelodyFingerprint.ToIntervals([60, 62, 60]));
    }

    [Theory]
    [InlineData(new int[0])]
    [InlineData(new[] { 60 })]
    public void ToIntervals_NeedsAtLeastTwoPitches(int[] midis)
    {
        Assert.Empty(MelodyFingerprint.ToIntervals(midis));
    }

    [Fact]
    public void ToIntervals_AllOnePitchYieldsNothing()
    {
        Assert.Empty(MelodyFingerprint.ToIntervals([60, 60, 60, 60]));
    }

    [Fact]
    public void IntervalString_RoundTrips()
    {
        int[] midis = [60, 62, 64, 60, 72];
        var serialized = MelodyFingerprint.ToIntervalString(midis);

        Assert.Equal("2,2,-4,12", serialized);
        Assert.Equal(MelodyFingerprint.ToIntervals(midis), MelodyFingerprint.ParseIntervalString(serialized));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ParseIntervalString_TreatsMissingValuesAsEmpty(string? stored)
    {
        Assert.Empty(MelodyFingerprint.ParseIntervalString(stored));
    }

    [Theory]
    [InlineData("2,,3", new[] { 2, 3 })]
    [InlineData("2,3,", new[] { 2, 3 })]
    [InlineData("2, 3", new[] { 2, 3 })]
    [InlineData("2,x,3", new[] { 2, 3 })]
    [InlineData("x", new int[0])]
    public void ParseIntervalString_SkipsUnparseableValuesRatherThanThrowing(string stored, int[] expected)
    {
        // Every stored fingerprint is parsed in one pass when the match index rebuilds, so one
        // malformed legacy row must cost that row and nothing else.
        Assert.Equal(expected, MelodyFingerprint.ParseIntervalString(stored));
    }

    [Fact]
    public void Shingles_ProducesOneHashPerWindow()
    {
        int[] intervals = [1, 2, 3, 4, 5, 6, 7];

        Assert.Equal(3, MelodyFingerprint.Shingles(intervals).Count()); // 7 - 5 + 1
    }

    [Fact]
    public void Shingles_YieldsNothingWhenShorterThanTheWindow()
    {
        Assert.Empty(MelodyFingerprint.Shingles([1, 2, 3]));
    }

    [Fact]
    public void Shingles_AreOrderSensitiveButPositionIndependent()
    {
        int[] a = [1, 2, 3, 4, 5];
        int[] b = [9, 9, 1, 2, 3, 4, 5];
        int[] reordered = [5, 4, 3, 2, 1];

        // The same 5-gram appearing later in a longer sequence hashes identically...
        Assert.Contains(MelodyFingerprint.Shingles(a).Single(), MelodyFingerprint.Shingles(b));
        // ...but a different ordering of the same intervals does not.
        Assert.DoesNotContain(MelodyFingerprint.Shingles(a).Single(), MelodyFingerprint.Shingles(reordered));
    }

    [Fact]
    public void LocalAlign_IdenticalSequencesScorePerfectly()
    {
        int[] query = [2, 2, 1, 2, 2];

        var result = MelodyFingerprint.LocalAlign(query, query);

        Assert.Equal(query.Length * 4, result.Score); // ExactMatchScore = 4
        Assert.Equal(query.Length, result.MatchedLength);
    }

    [Fact]
    public void LocalAlign_FindsAQueryEmbeddedInALongerCandidate()
    {
        int[] query = [2, 2, 1, 2, 2];
        int[] candidate = [7, -3, 5, .. query, -4, 9, 2];

        var result = MelodyFingerprint.LocalAlign(query, candidate);

        // The unmatched head and tail of the candidate are not penalized.
        Assert.Equal(query.Length * 4, result.Score);
        Assert.Equal(query.Length, result.MatchedLength);
    }

    [Fact]
    public void LocalAlign_GivesPartialCreditForAnOctaveError()
    {
        // An octave-off note is a known pitch-detector failure mode, so it scores
        // above a mismatch but below an exact hit.
        int[] query = [2, 2, 1, 2];
        int[] octaveOff = [2, 14, 1, 2];   // second interval is 12 semitones out
        int[] wrongNote = [2, 5, 1, 2];

        var exact = MelodyFingerprint.LocalAlign(query, query).Score;
        var octave = MelodyFingerprint.LocalAlign(query, octaveOff).Score;
        var wrong = MelodyFingerprint.LocalAlign(query, wrongNote).Score;

        Assert.True(exact > octave, $"exact {exact} should beat octave-off {octave}");
        Assert.True(octave > wrong, $"octave-off {octave} should beat a wrong note {wrong}");
    }

    [Fact]
    public void LocalAlign_ChargesABurstOfNoiseOnceRatherThanPerNote()
    {
        // Affine gaps: one 3-note burst of inserted noise must cost less than three
        // separate single-note insertions, which is why Gotoh's formulation is used.
        int[] query = [2, 2, 1, 2, 2, 1, 2, 2];
        int[] burst = [2, 2, 1, 2, 9, 9, 9, 2, 1, 2, 2];
        int[] scattered = [2, 2, 9, 1, 2, 9, 2, 1, 9, 2, 2];

        var burstScore = MelodyFingerprint.LocalAlign(query, burst).Score;
        var scatteredScore = MelodyFingerprint.LocalAlign(query, scattered).Score;

        Assert.True(burstScore > scatteredScore,
            $"one burst ({burstScore}) should cost less than three scattered inserts ({scatteredScore})");
    }

    [Theory]
    [InlineData(new int[0], new[] { 1, 2, 3 })]
    [InlineData(new[] { 1, 2, 3 }, new int[0])]
    public void LocalAlign_EmptyInputScoresNothing(int[] query, int[] candidate)
    {
        var result = MelodyFingerprint.LocalAlign(query, candidate);

        Assert.Equal(0, result.Score);
        Assert.Equal(0, result.MatchedLength);
    }

    [Fact]
    public void Confidence_APerfectSelfMatchIsOneHundred()
    {
        int[] query = [2, 2, 1, 2, 2, 1];

        var confidence = MelodyFingerprint.Confidence(MelodyFingerprint.LocalAlign(query, query), query.Length);

        Assert.Equal(100, confidence);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public void Confidence_IsZeroForAQueryTooShortToBeMeaningful(int queryLength)
    {
        // Guards the spurious "100% match from two arbitrary notes" the floor was added for.
        var perfect = new MelodyFingerprint.AlignmentResult(queryLength * 4, queryLength);

        Assert.Equal(0, MelodyFingerprint.Confidence(perfect, queryLength));
    }

    [Fact]
    public void Confidence_IsZeroWhenTheAlignmentCoveredTooLittleOfTheQuery()
    {
        // 5 of 10 intervals matched is below the 0.65 coverage floor, however well they scored.
        var thinButHighScoring = new MelodyFingerprint.AlignmentResult(Score: 20, MatchedLength: 5);

        Assert.Equal(0, MelodyFingerprint.Confidence(thinButHighScoring, queryLength: 10));
    }

    [Fact]
    public void Confidence_IsClampedToOneHundred()
    {
        var impossiblyHigh = new MelodyFingerprint.AlignmentResult(Score: 10_000, MatchedLength: 8);

        Assert.Equal(100, MelodyFingerprint.Confidence(impossiblyHigh, queryLength: 8));
    }

    [Fact]
    public void Confidence_ANoisyButRecognizableQueryClearsTheSurfacingThreshold()
    {
        // A clean 12-interval phrase with one wrong note in the middle should still
        // be confidently identified.
        int[] candidate = [2, 2, 1, 2, 2, 2, 1, 2, 2, 1, 2, 2];
        int[] played = [.. candidate];
        played[6] = 6; // one bad interval

        var confidence = MelodyFingerprint.Confidence(
            MelodyFingerprint.LocalAlign(played, candidate), played.Length);

        Assert.True(confidence > MelodyFingerprint.ConfidenceThresholdPercent,
            $"expected above the {MelodyFingerprint.ConfidenceThresholdPercent}% threshold, got {confidence}");
    }

    [Fact]
    public void Confidence_AnUnrelatedQueryDoesNotClearTheSurfacingThreshold()
    {
        int[] candidate = [2, 2, 1, 2, 2, 2, 1, 2, 2, 1, 2, 2];
        int[] unrelated = [-7, 11, -5, 9, -8, 6, -11, 7, -6, 10, -9, 8];

        var confidence = MelodyFingerprint.Confidence(
            MelodyFingerprint.LocalAlign(unrelated, candidate), unrelated.Length);

        Assert.True(confidence < MelodyFingerprint.ConfidenceThresholdPercent,
            $"expected below the {MelodyFingerprint.ConfidenceThresholdPercent}% threshold, got {confidence}");
    }
}
