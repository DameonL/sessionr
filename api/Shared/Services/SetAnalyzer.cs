using SessionApp.Api.Models;

namespace SessionApp.Api.Services;

public record KeyTransition(string FromTitle, string ToTitle, string FromKey, string ToKey, int FifthsApart, string Label);

public record SetAnalysis(int TotalSeconds, string TotalPlaytime, List<KeyTransition> Transitions);

/// <summary>
/// Pure domain logic for medley sets: estimated playtime and analysis of the
/// key changes between consecutive tunes.
/// </summary>
public class SetAnalyzer
{
    // Rough seconds for one full pass (all parts with repeats) at session tempo.
    private static readonly Dictionary<TuneType, int> SecondsPerRound = new()
    {
        [TuneType.Reel] = 35,
        [TuneType.Jig] = 35,
        [TuneType.SlipJig] = 30,
        [TuneType.Hornpipe] = 40,
        [TuneType.Polka] = 25,
        [TuneType.Slide] = 30,
        [TuneType.Waltz] = 60,
        [TuneType.March] = 45,
        [TuneType.Strathspey] = 45,
        [TuneType.Barndance] = 40,
        [TuneType.Mazurka] = 40,
        [TuneType.Air] = 90,
        [TuneType.Other] = 40,
    };

    public SetAnalysis Analyze(IReadOnlyList<(string Title, TuneType Type, string Key, int Repetitions)> tunes)
    {
        var totalSeconds = tunes.Sum(t => SecondsPerRound.GetValueOrDefault(t.Type, 40) * t.Repetitions);

        var transitions = new List<KeyTransition>();
        for (var i = 0; i < tunes.Count - 1; i++)
        {
            var (fromTitle, _, fromKey, _) = tunes[i];
            var (toTitle, _, toKey, _) = tunes[i + 1];
            transitions.Add(DescribeTransition(fromTitle, toTitle, fromKey, toKey));
        }

        return new SetAnalysis(totalSeconds, FormatDuration(totalSeconds), transitions);
    }

    /// <summary>
    /// Scores a candidate as the next tune after the current last tune of a
    /// set: keep the rhythm type going, favor smooth or classic-lift key
    /// changes, and prefer tunes the player can actually deliver.
    /// </summary>
    public (int Score, string Reason) ScoreNextTune(
        TuneType lastType, string lastKey, TuneType candidateType, string candidateKey, TuneStatus status,
        int? lastEndingMidi = null, int? candidateStartingMidi = null)
    {
        var score = 0;
        var reasons = new List<string>();

        if (candidateType == lastType)
        {
            score += 50;
            reasons.Add($"keeps the {candidateType.ToString().ToLowerInvariant()}s going");
        }

        var from = ParseKeySignature(lastKey);
        var to = ParseKeySignature(candidateKey);
        if (from is not null && to is not null)
        {
            var steps = ((to.Value - from.Value) * 7) % 12;
            var fifths = steps > 6 ? steps - 12 : steps < -6 ? steps + 12 : steps;
            var (keyScore, keyReason) = fifths switch
            {
                0 when lastKey == candidateKey => (25, $"stays in {candidateKey}"),
                0 => (30, "relative key — seamless change"),
                1 => (30, "classic lift, one sharp brighter"),
                -1 => (22, "eases down a fifth"),
                2 or -2 => (8, "manageable key shift"),
                _ => (0, "bold key jump"),
            };
            score += keyScore;
            reasons.Add(keyReason);
        }

        // Melodic join: how the last tune's final note leads into the next tune's
        // first note. A shared or closely-related pitch makes the seam disappear.
        if (lastEndingMidi is int endMidi && candidateStartingMidi is int startMidi)
        {
            var interval = ((startMidi - endMidi) % 12 + 12) % 12;
            var (joinScore, joinReason) = interval switch
            {
                0 => (12, "lands on the same note"),
                5 or 7 => (8, "note leads by a fourth or fifth"),
                1 or 2 or 10 or 11 => (6, "steps straight in"),
                _ => (0, (string?)null),
            };
            score += joinScore;
            if (joinReason is not null)
            {
                reasons.Add(joinReason);
            }
        }

        var (statusScore, statusReason) = status switch
        {
            TuneStatus.Active => (15, "gig-ready"),
            TuneStatus.Rusty => (8, "chance to shake off rust"),
            TuneStatus.Learning => (4, "still learning it"),
            _ => (0, (string?)null),
        };
        score += statusScore;
        if (statusReason is not null)
        {
            reasons.Add(statusReason);
        }

        return (score, string.Join(" · ", reasons));
    }

    private static KeyTransition DescribeTransition(string fromTitle, string toTitle, string fromKey, string toKey)
    {
        var from = ParseKeySignature(fromKey);
        var to = ParseKeySignature(toKey);

        if (from is null || to is null)
        {
            return new KeyTransition(fromTitle, toTitle, fromKey, toKey, 0, "Unknown keys");
        }

        // Signed distance around the circle of fifths between the two key
        // signatures, in [-6, 6]. 0 = same signature (e.g. G major -> E minor).
        var steps = ((to.Value - from.Value) * 7) % 12;
        var fifths = steps > 6 ? steps - 12 : steps < -6 ? steps + 12 : steps;

        var label = Math.Abs(fifths) switch
        {
            0 when fromKey == toKey => "Same key",
            0 => "Relative keys — seamless",
            1 => fifths > 0 ? "One sharp brighter — classic lift" : "One flat darker — smooth",
            2 => "Two steps on the circle — noticeable shift",
            _ => "Distant keys — bold jump",
        };

        return new KeyTransition(fromTitle, toTitle, fromKey, toKey, fifths, label);
    }

    /// <summary>
    /// Parses keys like "G", "Em", "Edor", "Amix", "Bb" into the pitch class of
    /// the equivalent major key signature, or null if unparseable.
    /// </summary>
    private static int? ParseKeySignature(string key)
    {
        if (string.IsNullOrWhiteSpace(key))
        {
            return null;
        }

        key = key.Trim();
        var tonic = "C D EF G A B".IndexOf(char.ToUpperInvariant(key[0]), StringComparison.Ordinal);
        if (tonic < 0)
        {
            return null;
        }

        var rest = key[1..];
        if (rest.StartsWith('#'))
        {
            tonic++;
            rest = rest[1..];
        }
        else if (rest.StartsWith('b'))
        {
            tonic--;
            rest = rest[1..];
        }

        // Offset from the tonic to the major key sharing its signature
        // (e.g. E dorian carries the D major signature).
        var modeOffset = rest.ToLowerInvariant() switch
        {
            "" or "maj" or "major" or "ion" => 0,
            "m" or "min" or "minor" or "aeo" or "aeolian" => 3,
            "dor" or "dorian" => 10,
            "mix" or "mixolydian" => 5,
            "phr" or "phrygian" => 8,
            "lyd" or "lydian" => 7,
            "loc" or "locrian" => 1,
            _ => 0,
        };

        return ((tonic + modeOffset) % 12 + 12) % 12;
    }

    private static string FormatDuration(int totalSeconds) =>
        $"{totalSeconds / 60}:{totalSeconds % 60:D2}";
}
