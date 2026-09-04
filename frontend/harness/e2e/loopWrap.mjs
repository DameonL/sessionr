import { chromium } from '@playwright/test'

/**
 * Does an A/B loop actually loop, or does it wedge the player?
 *
 * The loop's wrap jumps the buffer with MidiBuffer.seek(), and abcjs's seek() restarts the sound
 * without re-latching startTimeSec — so the audio clock the cursor is anchored to went on reporting
 * the pre-jump position. The anchor then snapped the cursor straight back past B, which re-triggered
 * the wrap on the next beat, and the next: the buffer was stopped and re-kicked thousands of times
 * over a run, and the position bar sat pinned at B. Neither fault shows up in a note count.
 *
 * So watch the position bar and the buffer restarts together. A working loop sweeps A→B over and
 * over and restarts the sound once per sweep; the broken one stops sweeping and restarts it on
 * every frame.
 *
 * Run twice over: once on a plain single pass, and once with the repeat control set past the six
 * passes a buffer will hold, where the browser is looping the buffer's last pass underneath and a
 * jump has to be translated from the musical pass to the one the buffer actually has.
 */
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ok = (label, pass) => { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`); if (!pass) failed = true }
let failed = false

/** Longest buffer that is definitely not the tune — soundfont loading renders short ones. */
const NOT_THE_TUNE_SEC = 6

/** How long a loop to mark. Short enough to sweep several times inside one watch. */
const LOOP_SEC = 5

/** How long to watch, and how often to look. */
const WATCH_MS = 20000
const SAMPLE_MS = 250

async function run(label, repeatLimit, startShare) {
  console.log(`\n${label}`)
  const page = await browser.newPage()
  await page.addInitScript(([prefs, floor]) => {
    if (prefs) localStorage.setItem('sessionapp.player-prefs', JSON.stringify(prefs))
    window.__starts = 0
    const orig = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (w, o, d) {
      if (this.buffer && this.buffer.duration > floor && this.context instanceof AudioContext) window.__starts++
      return orig.call(this, w, o, d)
    }
  }, [repeatLimit === undefined ? null : { repeat: true, repeatLimit, bodhran: false }, NOT_THE_TUNE_SEC])
  await page.goto('http://localhost:5199/harness/?probe=cowboy&reps=1', { waitUntil: 'networkidle' })
  await page.waitForSelector('.sheet-music svg')

  // The loop button lives in the advanced panel, and can only mark once the durations are known.
  await page.getByRole('button', { name: /Advanced Controls/ }).click()
  const seekBar = page.locator('input[type=range]').first()
  await page.waitForFunction(() => Number(document.querySelector('input[type=range]')?.max) > 1)
  const totalSec = await seekBar.evaluate((el) => Number(el.max))

  /** Marks a loop point, by scrubbing there first. Returns the second it actually landed on. */
  async function mark(atSec) {
    // The seek bar steps in tenths, and fill() refuses a value off the step.
    const seconds = Number(atSec.toFixed(1))
    await seekBar.fill(String(seconds))
    await page.getByRole('button', { name: /Set loop (start|end)/ }).click()
    return seconds
  }

  // Marking while stopped is the natural way to set a loop up before playing, and is only possible
  // because the button is no longer disabled there.
  const aSec = await mark(startShare * totalSec)
  const bSec = await mark(aSec + LOOP_SEC)
  ok('a loop can be marked before playback starts', (await page.locator('.loop-marker').count()) === 2)

  await page.getByRole('button', { name: /▶ Play/ }).click()

  const positions = []
  const started = Date.now()
  // Driven off the wall clock rather than a step count: each round trip to the page costs more than
  // the wait does, and a step count would drift seconds adrift of the music.
  while (Date.now() - started < WATCH_MS) {
    await page.waitForTimeout(SAMPLE_MS)
    positions.push(Number(await seekBar.inputValue()))
  }
  const starts = await page.evaluate(() => window.__starts)
  await page.close()

  /** One sample's overshoot plus a beat's: the wrap is only tested once a beat. */
  const SLACK_SEC = 1
  // The bar holds the position it was scrubbed to until the sound actually starts — the start waits
  // on the audio device — so the run proper begins where playback first lands on A.
  const begun = positions.findIndex((p) => p <= aSec + 0.5)
  const settled = positions.slice(begun < 0 ? positions.length : begun)
  const wraps = settled.filter((p, i) => i > 0 && p < settled[i - 1] - 0.2).length
  const outside = settled.filter((p) => p < aSec - SLACK_SEC || p > bSec + SLACK_SEC)
  // The longest run of identical readings, not how many there are: two samples can honestly land on
  // the same note, but the pinned cursor never moved again.
  let stalled = 0
  for (let i = 1, run = 0; i < settled.length; i++) {
    run = Math.abs(settled[i] - settled[i - 1]) < 0.01 ? run + 1 : 0
    stalled = Math.max(stalled, run)
  }

  console.log(`  run ${totalSec.toFixed(1)}s, loop ${aSec.toFixed(1)}–${bSec.toFixed(1)}s`)
  console.log(`  positions: [${settled.map((p) => p.toFixed(1)).join(' ')}]`)
  console.log(`  ${wraps} wraps, longest stall ${stalled} samples, ${starts} buffer starts`)

  ok('playback starts at the loop, not where the bar was left', begun >= 0)
  ok(`the position wraps repeatedly (${wraps} times in ${WATCH_MS / 1000}s)`, wraps >= 2)
  ok(`the position never leaves the loop (${outside.length} samples outside)`, outside.length === 0)
  ok(`the position never sticks (longest stall ${stalled} of ${settled.length} samples)`, stalled <= 2)
  // Once for the start, once per wrap. The broken loop re-kicked the buffer on every frame.
  ok(`the sound restarts once per wrap, not per beat (${starts} starts for ${wraps} wraps)`, starts <= wraps + 2)
}

await run('a loop inside a single pass', undefined, 0.2)
// Eight passes is more than the six a buffer holds, so the browser loops the buffer's last pass and
// the seventh pass — which 0.78 of the way through is inside — has no buffer of its own. Its loop
// points have to be mapped back onto the pass standing in for it.
await run('a loop in a pass the buffer does not hold (repeat x8)', 8, 0.78)

await browser.close()
process.exit(failed ? 1 : 0)
