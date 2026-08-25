using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using SessionApp.Api.Models;

namespace SessionApp.Api.Services;

/// <summary>
/// Melodic facts derived from a tune's ABC, plus a rough difficulty score.
/// MIDI values are absolute (middle C = 60); null when the ABC has no notes.
/// Midis is the full ordered note sequence read off the ABC in written order
/// (repeats not unrolled) — the basis for the display/difficulty heuristics.
/// UnrolledMidis expands `|: :|`, `::`, and 1st/2nd endings into the note
/// sequence a full playthrough actually sounds — the basis for
/// MelodyFingerprint's interval matching, since a live-played sample
/// naturally spans repeats that the written text only states once.
/// </summary>
public record TuneMelodyStats(
    int? StartingMidi,
    int? EndingMidi,
    int? LowestMidi,
    int? HighestMidi,
    int NoteCount,
    int AccidentalCount,
    int PartCount,
    int Difficulty,
    IReadOnlyList<int> Midis,
    IReadOnlyList<int> UnrolledMidis);

/// <summary>
/// Pure domain logic that reads the notes out of a tune's ABC to derive
/// lightweight, storable heuristics: the first/last note (for set-medley
/// joins), the pitch range, part count, and a 0–100 difficulty estimate.
///
/// This is a deliberately forgiving note reader — it degrades rather than
/// throws on anything it doesn't understand (grace notes, decorations, chords,
/// inline fields), mirroring the frontend parser in
/// <c>frontend/src/services/earTraining.ts</c>.
/// </summary>
public class TuneHeuristics
{
    // MIDI-relative semitone of each natural note letter, within one octave.
    private static readonly Dictionary<char, int> LetterPitches = new()
    {
        ['c'] = 0, ['d'] = 2, ['e'] = 4, ['f'] = 5, ['g'] = 7, ['a'] = 9, ['b'] = 11,
    };

    private static readonly Regex NoteRe = new(@"^([\^=_]*)([A-Ga-g])([,']*)", RegexOptions.Compiled);

    // Barline tokens, longest/most-specific alternatives first so a bare "|"
    // doesn't shadow "|:", "|]", etc. Mirrors frontend/src/services/earTraining.ts's
    // BARLINE_RE, which this class's repeat-unrolling is ported from.
    private static readonly Regex BarlineRe = new(@"^(\|\]|\[\||\|\||::|:\||\|:|\||\[[1-9])", RegexOptions.Compiled);

    // Difficulty weights. Kept as named constants so the score stays tunable and
    // self-documenting (mirrors SetAnalyzer's style). Higher score = harder.
    private const int EasyRangeSemitones = 12;   // up to an octave is unremarkable
    private const double RangePerSemitone = 2.5; // each semitone beyond that
    private const int RangeCap = 25;
    private const double KeyPerAccidental = 3.5; // sharps/flats in the key signature
    private const int KeyCap = 20;
    private const double AccidentalDensityScale = 100.0; // fraction of notes with accidentals
    private const int AccidentalCap = 20;
    private const int PartOverTwo = 5;           // per part beyond the usual two
    private const int PartCap = 15;
    private const int HighRegisterFloor = 81;    // A5; whistle/fiddle upper reaches
    private const double HighRegisterPerSemitone = 1.5;
    private const int HighRegisterCap = 10;

    // Small per-rhythm baseline for the rhythmic/ornamentation demands of each type.
    private static readonly Dictionary<TuneType, int> TypeBaseline = new()
    {
        [TuneType.Reel] = 5,
        [TuneType.Jig] = 4,
        [TuneType.SlipJig] = 8,
        [TuneType.Hornpipe] = 8,
        [TuneType.Polka] = 3,
        [TuneType.Slide] = 6,
        [TuneType.Waltz] = 3,
        [TuneType.March] = 4,
        [TuneType.Strathspey] = 9,
        [TuneType.Barndance] = 6,
        [TuneType.Mazurka] = 6,
        [TuneType.Air] = 7,
        [TuneType.Other] = 5,
    };

    /// <summary>Computes the stats from an ABC string and its key/type, and writes them onto the tune.</summary>
    public void Apply(Tune tune)
    {
        var stats = Compute(tune.MasterAbcText, tune.Key, tune.TuneType);
        tune.StartingMidi = stats.StartingMidi;
        tune.EndingMidi = stats.EndingMidi;
        tune.LowestMidi = stats.LowestMidi;
        tune.HighestMidi = stats.HighestMidi;
        tune.NoteCount = stats.NoteCount;
        tune.AccidentalCount = stats.AccidentalCount;
        tune.PartCount = stats.PartCount;
        tune.Difficulty = stats.Difficulty;
        tune.FingerprintIntervals = MelodyFingerprint.ToIntervalString(stats.UnrolledMidis);
        tune.PitchClassProfile = MelodyFingerprint.ToPitchClassProfileString(stats.UnrolledMidis);
    }

    /// <summary>
    /// Computes and writes the match fingerprint for one setting from its own ABC.
    ///
    /// Settings are indexed alongside the master tune, so they have to be fingerprinted exactly
    /// the same way — same unrolled note sequence, same pitch-class profile. This exists so the
    /// several call sites that add or reprocess settings can't drift apart from
    /// <see cref="Apply"/>, which is precisely what happened when repeat-unrolling was added to
    /// the tune path and the setting paths kept using the written-order sequence.
    /// </summary>
    public void ApplyFingerprint(TuneSetting setting, TuneType tuneType)
    {
        var stats = Compute(setting.AbcText, setting.Key, tuneType);
        setting.FingerprintIntervals = MelodyFingerprint.ToIntervalString(stats.UnrolledMidis);
        setting.PitchClassProfile = MelodyFingerprint.ToPitchClassProfileString(stats.UnrolledMidis);
    }

    public TuneMelodyStats Compute(string? abc, string? key, TuneType tuneType)
    {
        var midis = new List<int>();
        var accidentalCount = 0;

        // Sharps in the key signature drive default note alterations. Prefer the
        // K: header inside the ABC; fall back to the tune's Key field.
        var sharps = KeySharps(ExtractKeyHeader(abc) ?? key ?? "") ?? 0;

        // Per-bar accidental memory (an accidental persists until the next barline).
        var barAccidentals = new Dictionary<string, int>();
        var body = abc ?? "";
        var i = 0;
        while (i < body.Length)
        {
            var ch = body[i];

            // Skip header/inline field lines like "K:G", "M:6/8", "T:Title".
            if (StartsAFieldLine(body, i) && i + 1 < body.Length
                && body[i + 1] == ':')
            {
                var eol = body.IndexOf('\n', i);
                i = eol < 0 ? body.Length : eol + 1;
                continue;
            }

            switch (ch)
            {
                case '"': // chord/annotation string — skip to closing quote
                    i = SkipTo(body, i + 1, '"');
                    continue;
                case '{': // grace notes — skip
                    i = SkipTo(body, i + 1, '}');
                    continue;
                case '!': // decoration like !trill! — skip to closing '!'
                    i = SkipTo(body, i + 1, '!');
                    continue;
                case '~':
                case '.':
                    i++;
                    continue;
                case '%': // comment to end of line
                    var nl = body.IndexOf('\n', i);
                    i = nl < 0 ? body.Length : nl;
                    continue;
                case '|':
                    barAccidentals.Clear();
                    i++;
                    continue;
                case '[':
                    // Inline field [K:...] or an ending marker [1 / [2 — skip the marker.
                    if (i + 1 < body.Length && (body[i + 1] == '|' || char.IsDigit(body[i + 1])))
                    {
                        i += 2;
                        continue;
                    }
                    // Otherwise a bracket chord [ceg]: read the first note, drop the rest.
                    var close = body.IndexOf(']', i + 1);
                    if (close > i)
                    {
                        var inner = body.Substring(i + 1, close - i - 1);
                        if (!Regex.IsMatch(inner, "^[A-Za-z]:")) // not an inline field
                        {
                            ReadNote(inner, 0, sharps, barAccidentals, midis, ref accidentalCount);
                        }
                        i = close + 1;
                        continue;
                    }
                    i++;
                    continue;
            }

            var consumed = ReadNote(body, i, sharps, barAccidentals, midis, ref accidentalCount);
            i += consumed > 0 ? consumed : 1;
        }

        var partCount = CountParts(body);

        if (midis.Count == 0)
        {
            return new TuneMelodyStats(null, null, null, null, 0, 0, partCount, 0, midis, midis);
        }

        int lowest = midis[0], highest = midis[0];
        foreach (var m in midis)
        {
            if (m < lowest) lowest = m;
            if (m > highest) highest = m;
        }

        var difficulty = ScoreDifficulty(highest - lowest, sharps, accidentalCount, midis.Count, partCount, highest, tuneType);
        var unrolledMidis = UnrollBars(ReadBars(body, sharps));

        return new TuneMelodyStats(
            midis[0], midis[^1], lowest, highest, midis.Count, accidentalCount, partCount, difficulty, midis, unrolledMidis);
    }

    /// <summary>1–5 star band for display, derived from the 0–100 difficulty.</summary>
    public static int ToStars(int difficulty) =>
        difficulty >= 70 ? 5 : difficulty >= 50 ? 4 : difficulty >= 32 ? 3 : difficulty >= 16 ? 2 : 1;

    /// <summary>
    /// Reads a single note token at <paramref name="pos"/>. Returns the number of
    /// characters consumed (0 if there is no note there).
    /// </summary>
    private static int ReadNote(
        string s, int pos, int sharps, Dictionary<string, int> barAccidentals,
        List<int> midis, ref int accidentalCount)
    {
        var match = NoteRe.Match(s[pos..]);
        if (!match.Success)
        {
            return 0;
        }

        var accidentals = match.Groups[1].Value;
        var letter = match.Groups[2].Value[0];
        var octaves = match.Groups[3].Value;

        var lower = char.ToLowerInvariant(letter);
        var midi = 60 + LetterPitches[lower];
        if (char.IsLower(letter)) midi += 12;
        foreach (var oct in octaves)
        {
            if (oct == '\'') midi += 12;
            else if (oct == ',') midi -= 12;
        }

        var accKey = letter + octaves;
        int alteration;
        if (accidentals.Length > 0)
        {
            alteration = accidentals switch
            {
                "^" => 1,
                "^^" => 2,
                "_" => -1,
                "__" => -2,
                _ => 0, // "=" natural
            };
            barAccidentals[accKey] = alteration;
            accidentalCount++;
        }
        else if (barAccidentals.TryGetValue(accKey, out var carried))
        {
            alteration = carried;
        }
        else
        {
            alteration = DefaultAlteration(lower, sharps);
        }

        midis.Add(midi + alteration);
        return match.Length;
    }

    /// <param name="OpensSection">
    /// True when this bar follows a repeat-open marker (<c>|:</c> or <c>::</c>).
    /// Tracked on the bar rather than read off the previous bar's trailing
    /// barline because the two markers can be adjacent with no bar between
    /// them — <c>A :| |: B</c> — in which case the <c>|:</c> would otherwise be
    /// dropped along with the empty bar it appears to terminate, and the second
    /// section would never be repeated.
    /// </param>
    private readonly record struct AbcBar(List<int> Midis, string BarlineAfter, int? EndingNumber, bool OpensSection);

    /// <summary>
    /// Splits the tune body into bars, tracking each bar's trailing barline
    /// token and 1st/2nd-ending marker — the structure <see cref="UnrollBars"/>
    /// needs to replay repeated sections. A second, bar-aware pass over the
    /// same body <see cref="Compute"/> already scanned flatly; kept separate
    /// so the well-tested flat scan (written-order Midis/NoteCount/Difficulty)
    /// is untouched by this addition.
    /// </summary>
    private static List<AbcBar> ReadBars(string body, int sharps)
    {
        var bars = new List<AbcBar>();
        var barAccidentals = new Dictionary<string, int>();
        var currentMidis = new List<int>();
        int? currentEnding = null;
        var pendingOpensSection = true; // the first bar opens the first section
        var unusedAccidentalCount = 0;

        void Flush(string barlineAfter)
        {
            if (currentMidis.Count > 0)
            {
                bars.Add(new AbcBar(currentMidis, barlineAfter, currentEnding, pendingOpensSection));
                pendingOpensSection = false;
            }
            currentMidis = [];
            barAccidentals.Clear();
        }

        var i = 0;
        while (i < body.Length)
        {
            if (StartsAFieldLine(body, i) && i + 1 < body.Length
                && body[i + 1] == ':')
            {
                var eol = body.IndexOf('\n', i);
                i = eol < 0 ? body.Length : eol + 1;
                continue;
            }

            var barMatch = BarlineRe.Match(body[i..]);
            if (barMatch.Success)
            {
                var token = barMatch.Value;
                Flush(token);
                i += token.Length;

                if (token is "|:" or "::") pendingOpensSection = true;

                if (token[0] == '[' && token.Length > 1 && char.IsDigit(token[1]))
                {
                    currentEnding = token[1] - '0';
                }
                else if (i < body.Length && body[i] >= '1' && body[i] <= '9')
                {
                    currentEnding = body[i] - '0';
                    i++;
                }
                else
                {
                    currentEnding = null;
                }
                continue;
            }

            var ch = body[i];
            switch (ch)
            {
                case '"':
                    i = SkipTo(body, i + 1, '"');
                    continue;
                case '{':
                    i = SkipTo(body, i + 1, '}');
                    continue;
                case '!':
                    i = SkipTo(body, i + 1, '!');
                    continue;
                case '~':
                case '.':
                    i++;
                    continue;
                case '%':
                    var nl = body.IndexOf('\n', i);
                    i = nl < 0 ? body.Length : nl;
                    continue;
                case '[':
                    var close = body.IndexOf(']', i + 1);
                    if (close > i)
                    {
                        var inner = body.Substring(i + 1, close - i - 1);
                        if (!Regex.IsMatch(inner, "^[A-Za-z]:"))
                        {
                            ReadNote(inner, 0, sharps, barAccidentals, currentMidis, ref unusedAccidentalCount);
                        }
                        i = close + 1;
                        continue;
                    }
                    i++;
                    continue;
            }

            var consumed = ReadNote(body, i, sharps, barAccidentals, currentMidis, ref unusedAccidentalCount);
            i += consumed > 0 ? consumed : 1;
        }
        Flush("|]");

        return bars;
    }

    /// <summary>
    /// Replays `|: :|`, `::`, and 1st/2nd endings into the note sequence a
    /// full playthrough actually sounds, in bar order. Ported from
    /// frontend/src/services/earTraining.ts's buildEarTrainingTune, which
    /// unrolls the same way for ear-training excerpts.
    /// </summary>
    private static List<int> UnrollBars(List<AbcBar> bars)
    {
        var unrolled = new List<AbcBar>();
        var sectionStart = 0;
        var playedRepeatForSection = false;

        for (var idx = 0; idx < bars.Count; idx++)
        {
            var bar = bars[idx];

            if (idx > 0 && bar.OpensSection)
            {
                sectionStart = idx;
                playedRepeatForSection = false;
            }

            unrolled.Add(bar);

            var hasRepeat = bar.BarlineAfter == ":|" || bar.BarlineAfter == "::";
            if (hasRepeat && !playedRepeatForSection)
            {
                var sectionBars = bars.GetRange(sectionStart, idx - sectionStart + 1);
                var firstEndingIndex = sectionBars.FindIndex(b => b.EndingNumber == 1);

                if (firstEndingIndex != -1)
                {
                    unrolled.AddRange(sectionBars.Take(firstEndingIndex));

                    var nextIdx = idx + 1;
                    var secondEndingBars = new List<AbcBar>();
                    while (nextIdx < bars.Count && bars[nextIdx].EndingNumber == 2)
                    {
                        secondEndingBars.Add(bars[nextIdx]);
                        nextIdx++;
                    }
                    unrolled.AddRange(secondEndingBars);
                    idx = nextIdx - 1;
                }
                else
                {
                    unrolled.AddRange(sectionBars);
                }

                playedRepeatForSection = true;
                sectionStart = idx + 1;
            }
        }

        var midis = new List<int>();
        foreach (var b in unrolled) midis.AddRange(b.Midis);
        return midis;
    }

    /// <summary>Rough part count: each repeat-end (:|) or repeat-bridge (::) closes a part.</summary>
    private static int CountParts(string body)
    {
        var parts = 0;
        for (var i = 0; i < body.Length - 1; i++)
        {
            if (body[i] == ':' && body[i + 1] == '|') parts++;
            else if (body[i] == ':' && body[i + 1] == ':') parts++;
        }
        return Math.Max(1, parts);
    }

    private static int ScoreDifficulty(
        int rangeSpan, int sharps, int accidentalCount, int noteCount, int partCount, int highest, TuneType type)
    {
        double score = TypeBaseline.GetValueOrDefault(type, 5);

        score += Math.Min(RangeCap, Math.Max(0, rangeSpan - EasyRangeSemitones) * RangePerSemitone);
        score += Math.Min(KeyCap, Math.Abs(sharps) * KeyPerAccidental);

        if (noteCount > 0)
        {
            var density = (double)accidentalCount / noteCount;
            score += Math.Min(AccidentalCap, density * AccidentalDensityScale);
        }

        score += Math.Min(PartCap, Math.Max(0, partCount - 2) * PartOverTwo);

        if (highest > HighRegisterFloor)
        {
            score += Math.Min(HighRegisterCap, (highest - HighRegisterFloor) * HighRegisterPerSemitone);
        }

        return (int)Math.Round(Math.Clamp(score, 0, 100));
    }

    /// <summary>
    /// True when position <paramref name="i"/> is the first non-blank character of a line, so a
    /// "K:" / "M:" / "T:" there is a field line rather than melody. Leading whitespace has to be
    /// tolerated: a mid-tune key change is conventionally written indented under the preceding
    /// bar, and requiring the letter to sit flush against the newline let the key letter itself
    /// be read as a note — an indented "K:G" silently added a G to the tune.
    /// </summary>
    private static bool StartsAFieldLine(string body, int i)
    {
        if (!char.IsLetter(body[i])) return false;
        for (var j = i - 1; j >= 0; j--)
        {
            if (body[j] == '\n') return true;
            if (body[j] != ' ' && body[j] != '\t') return false;
        }
        return true;
    }

    private static int SkipTo(string s, int from, char delimiter)
    {
        var idx = s.IndexOf(delimiter, from);
        return idx < 0 ? s.Length : idx + 1;
    }

    private static string? ExtractKeyHeader(string? abc)
    {
        if (string.IsNullOrEmpty(abc)) return null;
        foreach (var raw in abc.Split('\n'))
        {
            var line = raw.Trim();
            if (line.StartsWith("K:", StringComparison.OrdinalIgnoreCase))
            {
                var val = line[2..].Split('%')[0].Trim();
                return val.Split(' ')[0]; // key sits first; drop any "clef=" etc.
            }
        }
        return null;
    }

    /// <summary>Default sharp/flat for a note letter implied by the key signature.</summary>
    private static int DefaultAlteration(char letter, int sharps)
    {
        // Order in which sharps / flats are added to a key signature.
        const string sharpOrder = "fcgdaeb";
        const string flatOrder = "beadgcf";
        if (sharps > 0 && sharpOrder[..sharps].Contains(letter)) return 1;
        if (sharps < 0 && flatOrder[..(-sharps)].Contains(letter)) return -1;
        return 0;
    }

    /// <summary>Number of sharps (negative = flats) in a key like "G", "Edor", "Bb", "Amix".</summary>
    private static int? KeySharps(string key)
    {
        var major = MajorPitchClass(key);
        if (major is null) return null;
        var sharps = (major.Value * 7) % 12;
        if (sharps > 6) sharps -= 12;
        return sharps;
    }

    /// <summary>
    /// Pitch class of the major key sharing the given key's signature
    /// (e.g. "Edor" -> D major -> 2), or null if unparseable. Mirrors
    /// SetAnalyzer.ParseKeySignature.
    /// </summary>
    private static int? MajorPitchClass(string key)
    {
        if (string.IsNullOrWhiteSpace(key)) return null;
        key = key.Trim();

        var tonic = "C D EF G A B".IndexOf(char.ToUpperInvariant(key[0]));
        if (tonic < 0) return null;

        var rest = key[1..];
        if (rest.StartsWith('#')) { tonic++; rest = rest[1..]; }
        else if (rest.StartsWith('b')) { tonic--; rest = rest[1..]; }

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
}
