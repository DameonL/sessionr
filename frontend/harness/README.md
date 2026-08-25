# Browser harness

Mounts `SetPlayer` on its own, with fixed tunes and no auth or API, so player behaviour that only
shows up in a real browser — audio timing, the moving cursor, click-to-hear — can be driven and
measured. The full app needs sign-in and a backend, which makes it a poor subject for this.

```
npm run harness            # vite dev server on :5199
npm run harness:e2e        # the checks below, against a running harness
```

`?set` on the URL renders a two-tune set instead of a single tune.

- `e2e/startSync.mjs` — where the cursor is when the sound starts, under CPU throttling. Reports a
  negative gap when the staff is painted before the first sample, which is what we want: the tune
  must not already be under way by the time anything appears.
- `e2e/cursorSync.mjs` — the staff and ABC cursors track the same note through play, view switches,
  pause/resume and stop.
