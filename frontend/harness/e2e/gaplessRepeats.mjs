import { chromium } from '@playwright/test'

/**
 * Do a tune's repetitions actually arrive as one continuous sound, without the lead-in?
 *
 * Repetitions used to be played by seeking one pass's buffer back to zero and starting it again,
 * which put an audible gap at every repeat and replayed the tune's lead-in each time — on The
 * Cowboy, whose `BA` sits outside the first repeat, two extra eighth notes a pass. Both faults are
 * invisible to a test that counts notes, and neither can be read off the code.
 *
 * So measure the rendered buffer instead. One buffer for the whole tune is what "no gap" means
 * here, and its length says exactly how many passes and how many lead-ins went into it. Beyond the
 * passes a buffer is allowed to hold, the browser loops its last pass instead, which has to carry
 * on just as seamlessly — and is the only way an unlimited repeat can work at all.
 */
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ok = (label, pass) => { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`); if (!pass) failed = true }
let failed = false

/**
 * Longest buffer that is definitely not the tune. Loading the soundfont renders a few buffers of a
 * couple of seconds along the way, and every probe here runs to at least twelve.
 */
const NOT_THE_TUNE_SEC = 6

/** Saved player preferences that turn the repeat control on, or null to leave them as they are. */
const repeatPrefs = (limit) =>
  limit === undefined ? null : { repeat: true, repeatLimit: limit, bodhran: false }

/**
 * Plays the probe `reps` times and reports every audio buffer the player rendered for it.
 * `repeatLimit`, when given, drives the repeat control instead — which is the only way the
 * single-tune player repeats anything, since it always passes repetitions of 1.
 */
async function render(reps, repeatLimit = undefined) {
  const p = await browser.newPage()
  await p.addInitScript(([prefs, floor]) => {
    // null means leave the saved preferences alone; a repeat limit of null inside it means infinite,
    // which is why this can't lean on undefined — Playwright turns that into null on the way over.
    if (prefs) localStorage.setItem('sessionapp.player-prefs', JSON.stringify(prefs))
    window.__buffers = []
    const orig = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (w, o, d) {
      if (this.buffer && this.buffer.duration > floor && this.context instanceof AudioContext) {
        window.__buffers.push(this.buffer.duration)
      }
      return orig.call(this, w, o, d)
    }
  }, [repeatPrefs(repeatLimit), NOT_THE_TUNE_SEC])
  await p.goto(`http://localhost:5199/harness/?probe=cowboy&reps=${reps}`, { waitUntil: 'networkidle' })
  await p.waitForSelector('.sheet-music svg')
  await p.getByRole('button', { name: /▶ Play/ }).click()
  // Long enough to prime and start; the buffer is fully rendered before a sample of it is heard,
  // so there is no need to sit through the tune.
  await p.waitForTimeout(6000)
  const buffers = await p.evaluate(() => window.__buffers)
  const seekBarSec = await p.evaluate(() => Number(document.querySelector('input[type=range]')?.max))
  await p.close()
  return { buffers, seekBarSec }
}

const single = await render(1)
const triple = await render(3)
// The single-tune player hardcodes repetitions to 1, so its repeats come from the repeat control.
const repeated = await render(1, 3)
const one = single.buffers
const three = triple.buffers
console.log(`buffers for 1 pass: [${one.map((d) => d.toFixed(3))}]`)
console.log(`buffers for 3 passes: [${three.map((d) => d.toFixed(3))}]`)
console.log(`buffers for repeat x3: [${repeated.buffers.map((d) => d.toFixed(3))}]  seek bar ${repeated.seekBarSec.toFixed(3)}s`)

ok('one pass renders one buffer', one.length === 1)
ok('three passes still render one buffer, so nothing restarts mid-tune', three.length === 1)
ok('a repeat of three builds the same single buffer as repetitions of three', repeated.buffers.length === 1 && Math.abs(repeated.buffers[0] - three[0]) < 0.01)
ok(
  `the position bar spans every repeat, not one pass (${repeated.seekBarSec.toFixed(1)}s vs ${single.seekBarSec.toFixed(1)}s for one)`,
  Math.abs(repeated.seekBarSec - (three[0] - 0.2)) < 0.05,
)

if (one.length === 1 && three.length === 1) {
  // abcjs pads every buffer with the same fade tail, so it cancels out of the comparison once.
  const FADE_SEC = 0.2
  // The Cowboy is 6/8 at the harness's default tempo of one measure a second, and its lead-in is
  // two eighths — a third of a measure — which passes 2 and 3 do without.
  const LEAD_IN_SEC = 1 / 3
  const music1 = one[0] - FADE_SEC
  const music3 = three[0] - FADE_SEC
  const expected = music1 * 3 - LEAD_IN_SEC * 2
  console.log(`  one pass ${music1.toFixed(3)}s;  three ${music3.toFixed(3)}s;  expected ${expected.toFixed(3)}s`)
  ok(`three passes run three passes long (${music3.toFixed(3)}s vs ${expected.toFixed(3)}s)`, Math.abs(music3 - expected) < 0.05)
  ok(
    `the lead-in is dropped on the repeats, not replayed (${(music1 * 3 - music3).toFixed(3)}s shorter than three whole passes)`,
    Math.abs(music1 * 3 - music3 - LEAD_IN_SEC * 2) < 0.05,
  )
}

/**
 * The audio no longer restarts at a repeat, so the cursor going back to the top is the only thing
 * that still happens there — and where the lead-in is dropped, it has to land past it rather than at
 * the very start, or it spends the rest of the pass a lead-in behind the music.
 *
 * Both probes are four bars of 6/8 with no repeat marks of their own, so the only backward jumps are
 * the pass boundaries, and three passes take twelve seconds.
 */
async function watchPasses(probe, firstNoteOnRepeat, { repeatLimit, passes = 3, seconds = 11500 } = {}) {
  const p = await browser.newPage()
  await p.addInitScript(([prefs, floor]) => {
    if (prefs) localStorage.setItem('sessionapp.player-prefs', JSON.stringify(prefs))
    window.__buffers = []
    const orig = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (w, o, d) {
      if (this.buffer && this.buffer.duration > floor && this.context instanceof AudioContext) window.__buffers.push(+this.buffer.duration.toFixed(2))
      return orig.call(this, w, o, d)
    }
  }, [repeatPrefs(repeatLimit), NOT_THE_TUNE_SEC])
  await p.goto(`http://localhost:5199/harness/?probe=${probe}&reps=${repeatLimit === undefined ? passes : 1}`, { waitUntil: 'networkidle' })
  await p.waitForSelector('.sheet-music svg')
  /** Which note on the staff is lit (-1 when none is), and whether the player is still going. */
  const sample = () =>
    p.evaluate(() => ({
      lit: [...document.querySelectorAll('.abcjs-note')].findIndex((n) => n.classList.contains('highlight')),
      playing: !!document.body.textContent.match(/⏸ Pause/),
    }))

  await p.getByRole('button', { name: /▶ Play/ }).click()
  let previous = -1
  let rewinds = 0
  let wentDark = 0
  let lowestAfterRewind = Infinity
  const started = Date.now()
  // Sampled well inside one note's length, so the first note of a repeat is never simply missed.
  // Driven off the wall clock rather than a step count, because each round trip to the page costs
  // more than the wait does and a step count would drift seconds adrift of the music.
  while (Date.now() - started < seconds) {
    await p.waitForTimeout(80)
    const elapsed = Date.now() - started
    const { lit, playing } = await sample()
    // The run is over when the player stops itself, which is the only reliable end: the cursor is
    // cleared then, and counting that as a dropped cursor would fail every finite repeat.
    if (!playing && elapsed > 2000) break
    if (lit === -1) {
      // The opening moments have no note sounding yet; anything after that is a dropped cursor.
      if (elapsed > 800) wentDark++
      continue
    }
    if (previous >= 0 && lit < previous) rewinds++
    if (rewinds > 0) lowestAfterRewind = Math.min(lowestAfterRewind, lit)
    previous = lit
  }
  const buffers = await p.evaluate(() => window.__buffers)
  await p.close()

  const label = repeatLimit === undefined ? probe : `${probe} x${repeatLimit} looped`
  console.log(`${label}: ${rewinds} rewinds, first note of a repeat ${lowestAfterRewind}, buffers [${buffers}]`)
  ok(`${label}: one buffer covers every pass however many there are`, buffers.length === 1)
  ok(`${label}: the cursor rewinds once per repeat and no more`, rewinds === passes - 1)
  ok(`${label}: the cursor stays on the music throughout${wentDark ? ` (dark for ${wentDark} samples)` : ''}`, wentDark === 0)
  ok(
    `${label}: a repeat never lights a note before ${firstNoteOnRepeat}, where its audio starts`,
    lowestAfterRewind >= firstNoteOnRepeat,
  )
}

// Nothing to drop, so every pass starts at the very first note.
await watchPasses('jig', 0)
// Two lead-in notes the repeats skip, so passes 2 and 3 start on the third note.
await watchPasses('leadin', 2)
// More passes than the buffer is allowed to hold, so the browser loops its last pass to cover the
// rest. Playback must carry on through the cap — pass 7 here — as if nothing happened.
await watchPasses('leadin', 2, { repeatLimit: 8, passes: 8, seconds: 45000 })

await browser.close()
process.exit(failed ? 1 : 0)
