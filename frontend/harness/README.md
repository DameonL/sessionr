# Browser harness

Mounts `SetPlayer` on its own, with fixed tunes and no auth or API, so player behaviour that only
shows up in a real browser — audio timing, the moving cursor, click-to-hear — can be driven and
measured. The full app needs sign-in and a backend, which makes it a poor subject for this.

```
npm run harness            # vite dev server on :5199
npm run harness:e2e        # the checks below, against a running harness
```

`?set` renders a two-tune set instead of a single tune. `?probe=reel|jig|pickup` renders a bare tune
of identical eighth notes — every note the same pitch and length, so anything that shows up as a
difference in the rendered audio can only have come from the code under test.

- `e2e/startSync.mjs` — where the cursor is when the sound starts, under CPU throttling. Reports a
  negative gap when the staff is painted before the first sample, which is what we want: the tune
  must not already be under way by the time anything appears.
- `e2e/cursorSync.mjs` — the staff and ABC cursors track the same note through play, view switches,
  pause/resume and stop.
- `e2e/meterEmphasis.mjs` — renders a probe tune with emphasis off and on and compares the two
  buffers sample for sample. Emphasis changes volume and never timing, so the renders line up and
  their ratio shows exactly where weight was added, with no onset detection to get wrong.
- `e2e/metronomeDownbeat.mjs` — counts accented clicks over a known number of bars, including a tune
  with a pickup. abcjs counts beats straight through the tune rather than per bar, so this is easy
  to get wrong and impossible to see from the code.
- `e2e/metronomeAudible.mjs` — the click's level against the tune's. The default click used to be a
  hi-hat sitting 15 dB below the music, which no amount of reading the code would have revealed.
