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
    public void LocalAlign_ScoresASemitoneNearMissBetweenAMatchAndAWrongNote()
    {
        // A semitone out is what a modal difference between two settings looks like, and what
        // the detector's own jitter produces — worth forgiving, not worth treating as correct.
        int[] query = [2, 2, 1, 2];
        int[] nearMiss = [2, 3, 1, 2];   // second interval one semitone out
        int[] wrongNote = [2, 7, 1, 2];

        var exact = MelodyFingerprint.LocalAlign(query, query).Score;
        var near = MelodyFingerprint.LocalAlign(query, nearMiss).Score;
        var wrong = MelodyFingerprint.LocalAlign(query, wrongNote).Score;

        Assert.True(exact > near, $"exact {exact} should beat a near miss {near}");
        Assert.True(near > wrong, $"a near miss {near} should beat a wrong note {wrong}");
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

    [Fact]
    public void LocalAlign_ConsolidatesAnOrnamentIntoASingleCandidateStep()
    {
        // The stored fingerprint strips ABC grace notes, but a live player's rolls/cuts/
        // trebles are fully-articulated real notes with no counterpart in the candidate.
        // Here the candidate's middle "1" interval is played as an inserted extra note:
        // two query intervals (7, -6) whose signed sum is still 1. A query built this way
        // should score exactly as well as playing the tune clean, not pay a gap penalty
        // for the extra note.
        int[] candidate = [2, 2, 1, 2, 2];
        int[] ornamented = [2, 2, 7, -6, 2, 2];

        var clean = MelodyFingerprint.LocalAlign(candidate, candidate);
        var result = MelodyFingerprint.LocalAlign(ornamented, candidate);

        Assert.Equal(clean.Score, result.Score);
        Assert.Equal(ornamented.Length, result.MatchedLength); // every query note consumed, ornament included
    }

    [Fact]
    public void LocalAlign_DoesNotGiveFreeCreditToNotesThatDoNotSumToTheCandidateInterval()
    {
        // Same shape as the ornament case, but the two inserted intervals (7, 7) sum to 14 —
        // not the candidate's "1" (nor its octave, 13 or 25 away) — so this is just two wrong
        // notes, not a plausible ornament, and must not consolidate for free.
        int[] candidate = [2, 2, 1, 2, 2];
        int[] ornamented = [2, 2, 7, -6, 2, 2];
        int[] wrongPair = [2, 2, 7, 7, 2, 2];

        var ornamentedScore = MelodyFingerprint.LocalAlign(ornamented, candidate).Score;
        var wrongPairScore = MelodyFingerprint.LocalAlign(wrongPair, candidate).Score;

        Assert.True(wrongPairScore < ornamentedScore,
            $"two notes that don't sum to the candidate interval ({wrongPairScore}) should score worse than a real ornament ({ornamentedScore})");
    }

    [Fact]
    public void TileToAtLeast_RepeatsAShortCandidateToReachTheQuery()
    {
        int[] candidate = [2, 2, 1];

        Assert.Equal([2, 2, 1, 2, 2, 1, 2, 2, 1], MelodyFingerprint.TileToAtLeast(candidate, 8));
    }

    [Fact]
    public void TileToAtLeast_LeavesACandidateAlreadyLongEnoughUntouched()
    {
        int[] candidate = [2, 2, 1, 2, 2];

        Assert.Same(candidate, MelodyFingerprint.TileToAtLeast(candidate, 5));
        Assert.Same(candidate, MelodyFingerprint.TileToAtLeast(candidate, 2));
    }

    [Fact]
    public void TileToAtLeast_LetsAQuerySpanningTwoPassesScoreLikeOne()
    {
        // A 20s sample covers more than one pass of a short tune, so the query outruns the
        // written fingerprint. Untiled, the surplus is unalignable and caps the score.
        int[] tune = [2, 2, 1, 2, 2, 1, -2, -2];
        int[] playedTwice = [.. tune, .. tune];

        var untiled = MelodyFingerprint.Confidence(
            MelodyFingerprint.LocalAlign(playedTwice, tune), playedTwice.Length);
        var tiled = MelodyFingerprint.Confidence(
            MelodyFingerprint.LocalAlign(playedTwice, MelodyFingerprint.TileToAtLeast(tune, playedTwice.Length)),
            playedTwice.Length);

        Assert.Equal(100, tiled);
        Assert.True(untiled < tiled, $"expected tiling to beat {untiled}, got {tiled}");
    }

    [Fact]
    public void PitchClassProfile_IsAUnitVectorOfPitchClassTransitions()
    {
        // C -> C, C -> E, E -> G. Indexed from * 12 + to.
        var profile = MelodyFingerprint.ToPitchClassProfile([60, 60, 64, 67]);

        Assert.Equal(144, profile.Length);
        Assert.Equal(1.0, Math.Sqrt(profile.Sum(v => v * v)), 6);
        Assert.True(profile[0 * 12 + 0] > 0, "C to C");
        Assert.True(profile[0 * 12 + 4] > 0, "C to E");
        Assert.True(profile[4 * 12 + 7] > 0, "E to G");
        Assert.Equal(0, profile[7 * 12 + 4]); // G to E never happens
    }

    [Fact]
    public void PitchClassProfile_OfAnEmptyMelodyIsAllZero()
    {
        Assert.All(MelodyFingerprint.ToPitchClassProfile([]), v => Assert.Equal(0, v));
    }

    [Fact]
    public void PitchClassProfile_SeparatesMelodiesThatShareANoteInventory()
    {
        // The reason this is a transition matrix and not a histogram. Both melodies use exactly
        // the same notes the same number of times, so a histogram cannot tell them apart at all;
        // they differ only in how the melody moves between those notes.
        int[] ascending = [60, 62, 64, 65, 60, 62, 64, 65];
        int[] shuffled = [60, 65, 62, 64, 60, 65, 62, 64];

        var a = MelodyFingerprint.ToPitchClassProfile(ascending);
        var b = MelodyFingerprint.ToPitchClassProfile(shuffled);

        Assert.True(MelodyFingerprint.PitchClassSimilarity(a, a) > MelodyFingerprint.PitchClassSimilarity(a, b),
            "a tune must match itself better than one built from the same notes in a different order");
    }

    [Fact]
    public void PitchClassSimilarity_IsTranspositionInvariant()
    {
        // The interval fingerprint is transposition-invariant by design; this must not
        // quietly reintroduce a key dependency.
        int[] inC = [60, 62, 64, 60, 67];
        var transposed = inC.Select(m => m + 3).ToArray();

        var similarity = MelodyFingerprint.PitchClassSimilarity(
            MelodyFingerprint.ToPitchClassProfile(inC),
            MelodyFingerprint.ToPitchClassProfile(transposed));

        Assert.Equal(1.0, similarity, 6);
    }

    [Fact]
    public void PitchClassSimilarity_SeparatesADifferentMelodicColour()
    {
        var diatonic = MelodyFingerprint.ToPitchClassProfile([60, 62, 64, 65, 67, 69, 71]);
        var chromaticCluster = MelodyFingerprint.ToPitchClassProfile([60, 61, 62, 61, 60, 61, 62]);

        Assert.True(
            MelodyFingerprint.PitchClassSimilarity(diatonic, diatonic)
            > MelodyFingerprint.PitchClassSimilarity(diatonic, chromaticCluster));
    }

    [Fact]
    public void PitchClassProfile_RoundTripsThroughItsStoredForm()
    {
        int[] midis = [60, 62, 64, 67];

        var parsed = MelodyFingerprint.ParsePitchClassProfile(
            MelodyFingerprint.ToPitchClassProfileString(midis));

        Assert.NotNull(parsed);
        var expected = MelodyFingerprint.ToPitchClassProfile(midis);
        for (var i = 0; i < 12; i++) Assert.Equal(expected[i], parsed![i], 4);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("1,2,3")]
    [InlineData("a,b,c,d,e,f,g,h,i,j,k,l")]
    public void ParsePitchClassProfile_ReturnsNullForAnythingUnusable(string? stored)
    {
        // One malformed legacy row must cost that row and nothing else, as with the intervals.
        Assert.Null(MelodyFingerprint.ParsePitchClassProfile(stored));
    }

    [Fact]
    public void FusedConfidence_FallsBackToAlignmentWhenAProfileIsMissing()
    {
        // A library that has not been backfilled yet must degrade to the previous behaviour.
        var profile = MelodyFingerprint.ToPitchClassProfile([60, 62, 64]);

        Assert.Equal(50, MelodyFingerprint.FusedConfidence(50, null, profile));
        Assert.Equal(50, MelodyFingerprint.FusedConfidence(50, profile, null));
    }

    [Fact]
    public void FusedConfidence_LiftsAMatchingProfileAndNotAClashingOne()
    {
        var query = MelodyFingerprint.ToPitchClassProfile([60, 62, 64, 65, 67, 69, 71]);
        var same = MelodyFingerprint.ToPitchClassProfile([60, 62, 64, 65, 67, 69, 71]);
        var clashing = MelodyFingerprint.ToPitchClassProfile([60, 61, 62, 61, 60, 61, 62]);

        Assert.True(MelodyFingerprint.FusedConfidence(40, query, same) > 40);
        Assert.True(MelodyFingerprint.FusedConfidence(40, query, clashing) < 40);
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
