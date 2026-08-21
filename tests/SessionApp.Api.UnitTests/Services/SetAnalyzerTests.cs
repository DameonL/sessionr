using SessionApp.Api.Models;
using SessionApp.Api.Services;

namespace SessionApp.Api.UnitTests.Services;

public class SetAnalyzerTests
{
    private readonly SetAnalyzer _analyzer = new();

    private static (string, TuneType, string, int) Tune(string title, TuneType type, string key, int reps = 1)
        => (title, type, key, reps);

    [Fact]
    public void Analyze_EmptySet_HasNoPlaytimeAndNoTransitions()
    {
        var analysis = _analyzer.Analyze([]);

        Assert.Equal(0, analysis.TotalSeconds);
        Assert.Equal("0:00", analysis.TotalPlaytime);
        Assert.Empty(analysis.Transitions);
    }

    [Fact]
    public void Analyze_SingleTune_HasNoTransitions()
    {
        var analysis = _analyzer.Analyze([Tune("Cooley's", TuneType.Reel, "Edor", 2)]);

        Assert.Equal(70, analysis.TotalSeconds); // 35s per reel round x 2
        Assert.Empty(analysis.Transitions);
    }

    [Fact]
    public void Analyze_PlaytimeSumsPerTypeRoundsTimesRepetitions()
    {
        var analysis = _analyzer.Analyze(
        [
            Tune("A Reel", TuneType.Reel, "D", 3),     // 35 x 3 = 105
            Tune("A Waltz", TuneType.Waltz, "G", 1),   // 60 x 1 =  60
            Tune("A Polka", TuneType.Polka, "A", 2),   // 25 x 2 =  50
        ]);

        Assert.Equal(215, analysis.TotalSeconds);
        Assert.Equal("3:35", analysis.TotalPlaytime);
    }

    [Fact]
    public void Analyze_PlaytimePadsTheSecondsComponent()
    {
        // 25 + 25 + 25 + 60 = 135s -> 2:15, and a bare 60s must render as 1:00 not 1:0.
        Assert.Equal("1:00", _analyzer.Analyze([Tune("W", TuneType.Waltz, "G")]).TotalPlaytime);
        Assert.Equal("0:25", _analyzer.Analyze([Tune("P", TuneType.Polka, "D")]).TotalPlaytime);
    }

    [Fact]
    public void Analyze_ProducesOneTransitionPerAdjacentPair()
    {
        var analysis = _analyzer.Analyze(
        [
            Tune("First", TuneType.Reel, "D"),
            Tune("Second", TuneType.Reel, "G"),
            Tune("Third", TuneType.Reel, "A"),
        ]);

        Assert.Equal(2, analysis.Transitions.Count);
        Assert.Equal(("First", "Second"), (analysis.Transitions[0].FromTitle, analysis.Transitions[0].ToTitle));
        Assert.Equal(("Second", "Third"), (analysis.Transitions[1].FromTitle, analysis.Transitions[1].ToTitle));
    }

    [Theory]
    [InlineData("D", "D", 0, "Same key")]
    [InlineData("G", "Em", 0, "Relative keys — seamless")]
    [InlineData("D", "A", 1, "One sharp brighter — classic lift")]
    [InlineData("D", "G", -1, "One flat darker — smooth")]
    [InlineData("D", "E", 2, "Two steps on the circle — noticeable shift")]
    [InlineData("D", "C", -2, "Two steps on the circle — noticeable shift")]
    [InlineData("D", "Bb", -4, "Distant keys — bold jump")]
    public void Analyze_LabelsTheCircleOfFifthsDistance(string fromKey, string toKey, int expectedFifths, string expectedLabel)
    {
        var analysis = _analyzer.Analyze([Tune("From", TuneType.Reel, fromKey), Tune("To", TuneType.Reel, toKey)]);

        var transition = Assert.Single(analysis.Transitions);
        Assert.Equal(expectedFifths, transition.FifthsApart);
        Assert.Equal(expectedLabel, transition.Label);
    }

    [Fact]
    public void Analyze_ReadsModalKeysByTheirParentSignature()
    {
        // E dorian and D major share a signature, so the move is seamless, not a jump.
        var analysis = _analyzer.Analyze([Tune("From", TuneType.Reel, "D"), Tune("To", TuneType.Reel, "Edor")]);

        var transition = Assert.Single(analysis.Transitions);
        Assert.Equal(0, transition.FifthsApart);
        Assert.Equal("Relative keys — seamless", transition.Label);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("H")]
    [InlineData("???")]
    public void Analyze_UnparseableKeysDegradeRatherThanThrow(string badKey)
    {
        var analysis = _analyzer.Analyze([Tune("From", TuneType.Reel, badKey), Tune("To", TuneType.Reel, "D")]);

        var transition = Assert.Single(analysis.Transitions);
        Assert.Equal("Unknown keys", transition.Label);
        Assert.Equal(0, transition.FifthsApart);
    }

    [Fact]
    public void Analyze_KeepsTheOriginalKeyTextOnTheTransition()
    {
        var analysis = _analyzer.Analyze([Tune("From", TuneType.Reel, "Edor"), Tune("To", TuneType.Reel, "Amix")]);

        var transition = Assert.Single(analysis.Transitions);
        Assert.Equal("Edor", transition.FromKey);
        Assert.Equal("Amix", transition.ToKey);
    }

    [Fact]
    public void ScoreNextTune_TheIdealFollowOnScoresHighest()
    {
        // Same type, same key, gig-ready: 50 + 25 + 15.
        var (score, reason) = _analyzer.ScoreNextTune(
            TuneType.Reel, "D", TuneType.Reel, "D", TuneStatus.Active);

        Assert.Equal(90, score);
        Assert.Contains("keeps the reels going", reason);
        Assert.Contains("stays in D", reason);
        Assert.Contains("gig-ready", reason);
    }

    [Fact]
    public void ScoreNextTune_ADifferentRhythmTypeLosesTheTypeBonus()
    {
        var same = _analyzer.ScoreNextTune(TuneType.Reel, "D", TuneType.Reel, "D", TuneStatus.Active);
        var different = _analyzer.ScoreNextTune(TuneType.Reel, "D", TuneType.Jig, "D", TuneStatus.Active);

        Assert.Equal(50, same.Score - different.Score);
        Assert.DoesNotContain("keeps the", different.Reason);
    }

    [Theory]
    [InlineData("D", "D", "stays in D")]
    [InlineData("G", "Em", "relative key — seamless")]
    [InlineData("D", "A", "classic lift, one sharp brighter")]
    [InlineData("D", "G", "eases down a fifth")]
    [InlineData("D", "E", "manageable key shift")]
    [InlineData("D", "Bb", "bold key jump")]
    public void ScoreNextTune_ExplainsTheKeyRelationship(string lastKey, string candidateKey, string expectedReason)
    {
        var (_, reason) = _analyzer.ScoreNextTune(
            TuneType.Reel, lastKey, TuneType.Reel, candidateKey, TuneStatus.Active);

        Assert.Contains(expectedReason, reason);
    }

    [Fact]
    public void ScoreNextTune_RanksTheKeyRelationshipsSensibly()
    {
        int Score(string toKey) => _analyzer.ScoreNextTune(
            TuneType.Reel, "D", TuneType.Reel, toKey, TuneStatus.Active).Score;

        // A relative-key or classic-lift move beats staying put, which beats
        // dropping a fifth, which beats a two-step shift, which beats a bold jump.
        Assert.True(Score("Bm") > Score("D"));   // relative (30) > same (25)
        Assert.True(Score("A") > Score("D"));    // lift (30) > same (25)
        Assert.True(Score("D") > Score("G"));    // same (25) > down a fifth (22)
        Assert.True(Score("G") > Score("E"));    // down a fifth (22) > two steps (8)
        Assert.True(Score("E") > Score("Bb"));   // two steps (8) > bold jump (0)
    }

    [Theory]
    [InlineData(TuneStatus.Active, 15, "gig-ready")]
    [InlineData(TuneStatus.Rusty, 8, "chance to shake off rust")]
    [InlineData(TuneStatus.Learning, 4, "still learning it")]
    public void ScoreNextTune_FavoursTunesThePlayerCanActuallyDeliver(TuneStatus status, int expectedBonus, string expectedReason)
    {
        var baseline = _analyzer.ScoreNextTune(TuneType.Reel, "D", TuneType.Reel, "D", TuneStatus.Wishlist);
        var scored = _analyzer.ScoreNextTune(TuneType.Reel, "D", TuneType.Reel, "D", status);

        Assert.Equal(expectedBonus, scored.Score - baseline.Score);
        Assert.Contains(expectedReason, scored.Reason);
    }

    [Fact]
    public void ScoreNextTune_WishlistTunesEarnNoStatusBonusOrReason()
    {
        var (_, reason) = _analyzer.ScoreNextTune(
            TuneType.Reel, "D", TuneType.Reel, "D", TuneStatus.Wishlist);

        Assert.DoesNotContain("gig-ready", reason);
        Assert.DoesNotContain("learning", reason);
    }

    [Theory]
    [InlineData(62, 62, 12, "lands on the same note")]   // unison
    [InlineData(62, 74, 12, "lands on the same note")]   // same pitch class, octave up
    [InlineData(62, 67, 8, "note leads by a fourth or fifth")]
    [InlineData(62, 69, 8, "note leads by a fourth or fifth")]
    [InlineData(62, 64, 6, "steps straight in")]
    [InlineData(62, 60, 6, "steps straight in")]
    public void ScoreNextTune_RewardsASmoothMelodicJoin(int lastEnding, int candidateStart, int expectedBonus, string expectedReason)
    {
        var withoutJoin = _analyzer.ScoreNextTune(TuneType.Reel, "D", TuneType.Reel, "D", TuneStatus.Active);
        var withJoin = _analyzer.ScoreNextTune(
            TuneType.Reel, "D", TuneType.Reel, "D", TuneStatus.Active, lastEnding, candidateStart);

        Assert.Equal(expectedBonus, withJoin.Score - withoutJoin.Score);
        Assert.Contains(expectedReason, withJoin.Reason);
    }

    [Fact]
    public void ScoreNextTune_AnAwkwardJoinEarnsNothingAndIsNotMentioned()
    {
        var withoutJoin = _analyzer.ScoreNextTune(TuneType.Reel, "D", TuneType.Reel, "D", TuneStatus.Active);
        var tritoneApart = _analyzer.ScoreNextTune(
            TuneType.Reel, "D", TuneType.Reel, "D", TuneStatus.Active, 62, 68);

        Assert.Equal(withoutJoin.Score, tritoneApart.Score);
        Assert.Equal(withoutJoin.Reason, tritoneApart.Reason);
    }

    [Fact]
    public void ScoreNextTune_SkipsTheJoinWhenEitherEndpointIsUnknown()
    {
        var baseline = _analyzer.ScoreNextTune(TuneType.Reel, "D", TuneType.Reel, "D", TuneStatus.Active);

        // Tunes whose heuristics have not been computed yet carry null midis.
        Assert.Equal(baseline.Score, _analyzer.ScoreNextTune(
            TuneType.Reel, "D", TuneType.Reel, "D", TuneStatus.Active, null, 62).Score);
        Assert.Equal(baseline.Score, _analyzer.ScoreNextTune(
            TuneType.Reel, "D", TuneType.Reel, "D", TuneStatus.Active, 62, null).Score);
    }

    [Fact]
    public void ScoreNextTune_UnparseableKeysSkipTheKeyComponentEntirely()
    {
        var (score, reason) = _analyzer.ScoreNextTune(
            TuneType.Reel, "???", TuneType.Reel, "D", TuneStatus.Active);

        Assert.Equal(65, score); // type 50 + status 15, no key contribution
        Assert.DoesNotContain("key", reason);
    }
}
