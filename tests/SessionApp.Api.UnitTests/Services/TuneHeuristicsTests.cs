using SessionApp.Api.Models;
using SessionApp.Api.Services;

namespace SessionApp.Api.UnitTests.Services;

public class TuneHeuristicsTests
{
    private readonly TuneHeuristics _heuristics = new();

    // Middle C = 60. Uppercase letters sit in the octave starting at middle C,
    // lowercase an octave above, so C=60 D=62 E=64 F=65 G=67 A=69 B=71, c=72 ...
    private const int MiddleC = 60;

    [Fact]
    public void Compute_EmptyAbc_YieldsNoNotes()
    {
        var stats = _heuristics.Compute("", "D", TuneType.Reel);

        Assert.Null(stats.StartingMidi);
        Assert.Null(stats.EndingMidi);
        Assert.Null(stats.LowestMidi);
        Assert.Null(stats.HighestMidi);
        Assert.Equal(0, stats.NoteCount);
        Assert.Equal(0, stats.Difficulty);
        Assert.Empty(stats.Midis);
    }

    [Fact]
    public void Compute_NullAbc_DoesNotThrow()
    {
        var stats = _heuristics.Compute(null, null, TuneType.Other);

        Assert.Equal(0, stats.NoteCount);
        Assert.Equal(1, stats.PartCount); // never less than one part
    }

    [Fact]
    public void Compute_ReadsNotesInWrittenOrder()
    {
        var stats = _heuristics.Compute("CDEFGABc", "C", TuneType.Reel);

        Assert.Equal([60, 62, 64, 65, 67, 69, 71, 72], stats.Midis);
        Assert.Equal(MiddleC, stats.StartingMidi);
        Assert.Equal(72, stats.EndingMidi);
        Assert.Equal(60, stats.LowestMidi);
        Assert.Equal(72, stats.HighestMidi);
        Assert.Equal(8, stats.NoteCount);
    }

    [Theory]
    [InlineData("C,", 48)]   // comma drops an octave
    [InlineData("C", 60)]
    [InlineData("c", 72)]    // lowercase is an octave up
    [InlineData("c'", 84)]   // apostrophe raises an octave
    [InlineData("c''", 96)]
    [InlineData("C,,", 36)]
    public void Compute_AppliesOctaveMarkers(string abc, int expectedMidi)
    {
        var stats = _heuristics.Compute(abc, "C", TuneType.Reel);

        Assert.Equal(expectedMidi, stats.StartingMidi);
    }

    [Fact]
    public void Compute_AppliesTheKeySignatureToUnmarkedNotes()
    {
        // D major carries F# and C#.
        var stats = _heuristics.Compute("K:D\nFC", null, TuneType.Reel);

        Assert.Equal([66, 61], stats.Midis); // F#4, C#4
        Assert.Equal(0, stats.AccidentalCount); // implied by the key, not written
    }

    [Fact]
    public void Compute_AppliesFlatKeySignatures()
    {
        // Bb major carries Bb and Eb.
        var stats = _heuristics.Compute("K:Bb\nBE", null, TuneType.Reel);

        Assert.Equal([70, 63], stats.Midis);
    }

    [Fact]
    public void Compute_ReadsModalKeysByTheirParentSignature()
    {
        // E dorian shares D major's signature (F#, C#), so F is sharpened.
        var dorian = _heuristics.Compute("K:Edor\nF", null, TuneType.Reel);
        var dMajor = _heuristics.Compute("K:D\nF", null, TuneType.Reel);

        Assert.Equal(dMajor.Midis, dorian.Midis);
        Assert.Equal(66, dorian.StartingMidi);
    }

    [Fact]
    public void Compute_PrefersTheKHeaderOverTheKeyField()
    {
        // The header says D (F#); the field says C (F natural). The header wins.
        var stats = _heuristics.Compute("K:D\nF", "C", TuneType.Reel);

        Assert.Equal(66, stats.StartingMidi);
    }

    [Fact]
    public void Compute_FallsBackToTheKeyFieldWhenTheAbcHasNoHeader()
    {
        var stats = _heuristics.Compute("F", "D", TuneType.Reel);

        Assert.Equal(66, stats.StartingMidi);
    }

    [Theory]
    [InlineData("^F", 66)]  // sharp
    [InlineData("^^F", 67)] // double sharp
    [InlineData("_B", 70)]  // flat
    [InlineData("__B", 69)] // double flat
    [InlineData("=F", 65)]  // natural cancels the key signature
    public void Compute_AppliesWrittenAccidentals(string abc, int expectedMidi)
    {
        var stats = _heuristics.Compute("K:C\n" + abc, null, TuneType.Reel);

        Assert.Equal(expectedMidi, stats.StartingMidi);
        Assert.Equal(1, stats.AccidentalCount);
    }

    [Fact]
    public void Compute_NaturalSignOverridesTheKeySignature()
    {
        var stats = _heuristics.Compute("K:D\n=F", null, TuneType.Reel);

        Assert.Equal(65, stats.StartingMidi); // F natural, not F#
    }

    [Fact]
    public void Compute_AnAccidentalCarriesToTheEndOfItsBarOnly()
    {
        // ^c applies to the second c as well, then the barline resets it.
        var stats = _heuristics.Compute("K:C\n^cc|cc", null, TuneType.Reel);

        Assert.Equal([73, 73, 72, 72], stats.Midis);
        Assert.Equal(1, stats.AccidentalCount); // only the written one counts
    }

    [Fact]
    public void Compute_AnAccidentalDoesNotCarryToOtherOctaves()
    {
        // The accidental memory is keyed by letter *and* octave markers.
        var stats = _heuristics.Compute("K:C\n^cC", null, TuneType.Reel);

        Assert.Equal([73, 60], stats.Midis);
    }

    [Fact]
    public void Compute_SkipsHeaderAndInlineFieldLines()
    {
        const string abc = """
            X:1
            T:Cooley's
            M:4/4
            L:1/8
            R:reel
            K:Edor
            EBBA
            """;

        var stats = _heuristics.Compute(abc, null, TuneType.Reel);

        // Only the tune body's four notes — no letters read out of the field lines.
        Assert.Equal(4, stats.NoteCount);
        Assert.Equal([64, 71, 71, 69], stats.Midis);
    }

    [Theory]
    [InlineData("\"Am\"CDE")]        // chord annotation
    [InlineData("{gag}CDE")]         // grace notes
    [InlineData("!trill!CDE")]       // decoration
    [InlineData("~C.DE")]            // roll and staccato marks
    [InlineData("CDE % trailing")]   // comment
    public void Compute_IgnoresNonMelodicMarkup(string abc)
    {
        var stats = _heuristics.Compute("K:C\n" + abc, null, TuneType.Reel);

        Assert.Equal([60, 62, 64], stats.Midis);
    }

    [Fact]
    public void Compute_ReadsOnlyTheFirstNoteOfABracketChord()
    {
        var stats = _heuristics.Compute("K:C\n[ceg]D", null, TuneType.Reel);

        Assert.Equal([72, 62], stats.Midis);
    }

    [Fact]
    public void Compute_SkipsRepeatEndingMarkers()
    {
        var stats = _heuristics.Compute("K:C\nC[1D:|[2E|]", null, TuneType.Reel);

        Assert.Equal([60, 62, 64], stats.Midis);
    }

    [Fact]
    public void Compute_SkipsInlineKeyChanges()
    {
        var stats = _heuristics.Compute("K:C\nC[K:D]D", null, TuneType.Reel);

        Assert.Equal([60, 62], stats.Midis);
    }

    [Theory]
    [InlineData("CDEF", 1)]                       // no repeat marks at all
    [InlineData("CDEF:|GABc:|", 2)]               // two repeat-ends
    [InlineData("CDEF::GABc:|", 2)]               // a repeat bridge plus a repeat-end
    [InlineData("CD:|EF:|GA:|", 3)]
    public void Compute_CountsPartsFromRepeatMarks(string body, int expectedParts)
    {
        var stats = _heuristics.Compute("K:C\n" + body, null, TuneType.Reel);

        Assert.Equal(expectedParts, stats.PartCount);
    }

    [Fact]
    public void Compute_DifficultyRisesWithPitchRange()
    {
        var narrow = _heuristics.Compute("K:C\nCDEC", null, TuneType.Reel);
        var wide = _heuristics.Compute("K:C\nC,DEc''", null, TuneType.Reel);

        Assert.True(wide.Difficulty > narrow.Difficulty,
            $"expected the wider-range tune to score higher, got {wide.Difficulty} vs {narrow.Difficulty}");
    }

    [Fact]
    public void Compute_DifficultyRisesWithKeySignatureAccidentals()
    {
        var plain = _heuristics.Compute("K:C\nCDEC", null, TuneType.Reel);
        var sharp = _heuristics.Compute("K:B\nCDEC", null, TuneType.Reel);

        Assert.True(sharp.Difficulty > plain.Difficulty);
    }

    [Fact]
    public void Compute_DifficultyRisesWithPartCountBeyondTwo()
    {
        var twoParts = _heuristics.Compute("K:C\nCDEC:|CDEC:|", null, TuneType.Reel);
        var fourParts = _heuristics.Compute("K:C\nCDEC:|CDEC:|CDEC:|CDEC:|", null, TuneType.Reel);

        Assert.True(fourParts.Difficulty > twoParts.Difficulty);
    }

    [Fact]
    public void Compute_DifficultyReflectsTheTypeBaseline()
    {
        const string body = "K:C\nCDEC";
        var polka = _heuristics.Compute(body, null, TuneType.Polka);       // baseline 3
        var strathspey = _heuristics.Compute(body, null, TuneType.Strathspey); // baseline 9

        Assert.Equal(3, polka.Difficulty);
        Assert.Equal(9, strathspey.Difficulty);
    }

    [Fact]
    public void Compute_DifficultyIsClampedToZeroThroughOneHundred()
    {
        // Everything dialled up at once: huge range, seven sharps, every note
        // accidental-marked, many parts, and a stratospheric top note.
        var body = "K:C#\n" + string.Concat(Enumerable.Repeat("^C,^c''", 8)) + string.Concat(Enumerable.Repeat(":|", 10));
        var stats = _heuristics.Compute(body, null, TuneType.Strathspey);

        Assert.InRange(stats.Difficulty, 0, 100);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(15, 1)]
    [InlineData(16, 2)]
    [InlineData(31, 2)]
    [InlineData(32, 3)]
    [InlineData(49, 3)]
    [InlineData(50, 4)]
    [InlineData(69, 4)]
    [InlineData(70, 5)]
    [InlineData(100, 5)]
    public void ToStars_BandsTheDifficultyScore(int difficulty, int expectedStars)
    {
        Assert.Equal(expectedStars, TuneHeuristics.ToStars(difficulty));
    }

    [Fact]
    public void Apply_WritesEveryComputedStatOntoTheTune()
    {
        var tune = new Tune
        {
            Title = "Cooley's",
            TuneType = TuneType.Reel,
            Key = "Edor",
            MasterAbcText = "K:Edor\nEBBA B2EB|B2AB dBAG:|",
        };

        _heuristics.Apply(tune);

        var expected = _heuristics.Compute(tune.MasterAbcText, tune.Key, tune.TuneType);
        Assert.Equal(expected.StartingMidi, tune.StartingMidi);
        Assert.Equal(expected.EndingMidi, tune.EndingMidi);
        Assert.Equal(expected.LowestMidi, tune.LowestMidi);
        Assert.Equal(expected.HighestMidi, tune.HighestMidi);
        Assert.Equal(expected.NoteCount, tune.NoteCount);
        Assert.Equal(expected.AccidentalCount, tune.AccidentalCount);
        Assert.Equal(expected.PartCount, tune.PartCount);
        Assert.Equal(expected.Difficulty, tune.Difficulty);
        Assert.Equal(MelodyFingerprint.ToIntervalString(expected.UnrolledMidis), tune.FingerprintIntervals);
    }

    [Fact]
    public void Apply_OnAbcWithoutNotes_LeavesTheMidiFieldsNull()
    {
        var tune = new Tune { Title = "Empty", TuneType = TuneType.Air, Key = "D", MasterAbcText = "K:D\n" };

        _heuristics.Apply(tune);

        Assert.Null(tune.StartingMidi);
        Assert.Null(tune.EndingMidi);
        Assert.Equal(0, tune.NoteCount);
        Assert.Equal("", tune.FingerprintIntervals);
    }

    [Fact]
    public void Compute_UnrollsASimpleRepeatForTheFingerprintButNotTheWrittenMidis()
    {
        var stats = _heuristics.Compute("K:C\n|:CDE:|", null, TuneType.Reel);

        // Written-order Midis (what NoteCount/Difficulty are derived from) stays literal.
        Assert.Equal([60, 62, 64], stats.Midis);
        Assert.Equal(3, stats.NoteCount);
        // The fingerprint basis plays the repeated section twice.
        Assert.Equal([60, 62, 64, 60, 62, 64], stats.UnrolledMidis);
    }

    [Fact]
    public void Compute_UnrollsFirstAndSecondEndingsSeparately()
    {
        // "|:CDE[1FG:|[2AB|]" plays CDE-FG the first time through, then repeats with
        // AB swapped in for the [2 ending instead of FG.
        var stats = _heuristics.Compute("K:C\n|:CDE[1FG:|[2AB|]", null, TuneType.Reel);

        Assert.Equal([60, 62, 64, 65, 67, 60, 62, 64, 69, 71], stats.UnrolledMidis);
    }

    [Fact]
    public void Compute_UnrollsARepeatBridgeOnceEachSide()
    {
        var stats = _heuristics.Compute("K:C\nCDE::FGA:|", null, TuneType.Reel);

        // "::" both closes the first section's repeat and opens the second's.
        Assert.Equal([60, 62, 64, 60, 62, 64, 65, 67, 69, 65, 67, 69], stats.UnrolledMidis);
    }

    [Fact]
    public void Compute_UnrollsBothSectionsWhenTheirRepeatMarkersAreAdjacent()
    {
        // ":| |:" back to back, with no bar between them — the normal way a two-part
        // tune is written. The opening marker of the second section terminates no bar
        // of its own, so reading section starts off the *previous* bar's trailing
        // barline silently lost it and left the second section un-repeated.
        var stats = _heuristics.Compute("K:C\n|:CDE:||:GAB:|", null, TuneType.Reel);

        Assert.Equal([60, 62, 64, 60, 62, 64, 67, 69, 71, 67, 69, 71], stats.UnrolledMidis);
    }

    [Fact]
    public void Compute_UnrollsBothSectionsWhenTheyAreOnSeparateLines()
    {
        var stats = _heuristics.Compute("K:C\n|:CDE:|\n|:GAB:|", null, TuneType.Reel);

        Assert.Equal([60, 62, 64, 60, 62, 64, 67, 69, 71, 67, 69, 71], stats.UnrolledMidis);
    }

    [Fact]
    public void Compute_SkipsAnIndentedMidTuneKeyChange()
    {
        // A key change part-way through a tune is conventionally written indented under the
        // preceding bar. Requiring the field letter to sit flush against the newline let the
        // key's own letter be read as a note.
        var stats = _heuristics.Compute("X:1\nK:C\nCD\n K:G\nEF", null, TuneType.Reel);

        Assert.Equal([60, 62, 64, 65], stats.Midis);
    }

    [Fact]
    public void Compute_SkipsAnIndentedFieldLineInTheUnrolledSequenceToo()
    {
        // Both scanners (the flat one and the bar-aware one behind UnrolledMidis) have to
        // agree, or the fingerprint picks up a note the note count never saw.
        var stats = _heuristics.Compute("X:1\nK:C\n|:CD:|\n K:G\n|:EF:|", null, TuneType.Reel);

        Assert.Equal([60, 62, 60, 62, 64, 65, 64, 65], stats.UnrolledMidis);
    }

    [Fact]
    public void Compute_TuneWithNoRepeatsHasIdenticalWrittenAndUnrolledMidis()
    {
        var stats = _heuristics.Compute("K:C\nCDEFGABc", null, TuneType.Reel);

        Assert.Equal(stats.Midis, stats.UnrolledMidis);
    }

    [Fact]
    public void Apply_ProducesATranspositionInvariantFingerprint()
    {
        // The same shape written in C and in D must fingerprint identically.
        var inC = new Tune { TuneType = TuneType.Reel, Key = "C", MasterAbcText = "K:C\nCEGE" };
        var inD = new Tune { TuneType = TuneType.Reel, Key = "D", MasterAbcText = "K:D\nDFAF" };

        _heuristics.Apply(inC);
        _heuristics.Apply(inD);

        Assert.Equal(inC.FingerprintIntervals, inD.FingerprintIntervals);
    }

    [Fact]
    public void ParseAndNormalizeAbc_ValidAbc_ExtractsPropertiesAndNormalizesHeaders()
    {
        const string rawAbc = """
            X:1
            T:  the   maid  
            R:  REEL  
            K: D major % original comment
            |:FAAF AFDF|
            """;

        var result = TuneHeuristics.ParseAndNormalizeAbc(rawAbc);

        Assert.True(result.IsValid);
        Assert.Empty(result.MissingHeaders);
        Assert.Equal("the maid", result.Title);
        Assert.Equal(TuneType.Reel, result.TuneType);
        Assert.Equal("D", result.Key);
        Assert.Contains("T:the maid", result.NormalizedAbc);
        Assert.Contains("R:reel", result.NormalizedAbc);
        Assert.Contains("K:D % original comment", result.NormalizedAbc);
    }

    [Fact]
    public void ParseAndNormalizeAbc_MissingHeaders_ReturnsInvalidAndListsMissing()
    {
        const string rawAbc = "X:1\n|:FAAF AFDF|";

        var result = TuneHeuristics.ParseAndNormalizeAbc(rawAbc);

        Assert.False(result.IsValid);
        Assert.Contains("Title (T: header)", result.MissingHeaders);
        Assert.Contains("Rhythm (R: header)", result.MissingHeaders);
        Assert.Contains("Key (K: header)", result.MissingHeaders);
    }

    [Theory]
    [InlineData("reel", TuneType.Reel)]
    [InlineData("jig", TuneType.Jig)]
    [InlineData("slip jig", TuneType.SlipJig)]
    [InlineData("hornpipe", TuneType.Hornpipe)]
    [InlineData("polka", TuneType.Polka)]
    [InlineData("slide", TuneType.Slide)]
    [InlineData("waltz", TuneType.Waltz)]
    [InlineData("march", TuneType.March)]
    [InlineData("strathspey", TuneType.Strathspey)]
    [InlineData("barndance", TuneType.Barndance)]
    [InlineData("mazurka", TuneType.Mazurka)]
    [InlineData("air", TuneType.Air)]
    [InlineData("unknown_rhythm", TuneType.Other)]
    public void ParseTuneType_MapsRhythmStrings(string rhythm, TuneType expectedType)
    {
        Assert.Equal(expectedType, TuneHeuristics.ParseTuneType(rhythm));
    }
}
