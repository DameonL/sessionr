import { chromium } from '@playwright/test'

/**
 * Does the Speed Trainer actually climb its ladder?
 *
 * Armed, it is meant to play the tune at Start BPM and step up by Step BPM at the end of every pass
 * until it reaches Target BPM. It used to restart every pass at Start BPM instead: the timer
 * callback that ends a pass was installed by a render in which `status` was still "stopped", so the
 * play() it closed over read itself as a fresh start and seeded the tempo from Start BPM again.
 * Nothing about that is visible in a note count — every pass plays the same notes — so measure the
 * rendered buffers, whose lengths are the tempo. Each pass builds its own buffer, and its duration
 * has to shrink in step with the ladder.
 */
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ok = (label, pass) => { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`); if (!pass) failed = true }
let failed = false

/** Longest buffer that is definitely not the tune; the soundfont renders short ones while loading. */
const NOT_THE_TUNE_SEC = 4
/** abcjs pads every buffer with the same fade tail, so it has to come off before lengths compare. */
const FADE_SEC = 0.2

const START_BPM = 120
const STEP_BPM = 60
const TARGET_BPM = 240
/** 120 → 180 → 240: three passes, and the run stops after the one at the target. */
const LADDER = [START_BPM, START_BPM + STEP_BPM, TARGET_BPM]

const page = await browser.newPage()
await page.addInitScript(([prefs, floor]) => {
  localStorage.setItem('sessionapp.player-prefs', JSON.stringify(prefs))
  window.__buffers = []
  const orig = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (w, o, d) {
    if (this.buffer && this.buffer.duration > floor && this.context instanceof AudioContext) {
      window.__buffers.push(+this.buffer.duration.toFixed(3))
    }
    return orig.call(this, w, o, d)
  }
}, [
  { repeat: false, repeatLimit: null, bodhran: false, trainer: { armed: true, startBpm: START_BPM, stepBpm: STEP_BPM, targetBpm: TARGET_BPM } },
  NOT_THE_TUNE_SEC,
])
// Two passes a rung, so even the fastest rung's buffer is comfortably longer than a loading one.
await page.goto('http://localhost:5199/harness/?probe=reel&reps=2', { waitUntil: 'networkidle' })
await page.waitForSelector('.sheet-music svg')
// The trainer's pass readout lives in the Advanced panel, which starts collapsed.
await page.getByRole('button', { name: /Advanced Controls/ }).click()
await page.getByRole('button', { name: /▶ Play/ }).click()

/** The trainer's own readout: which pass it is on, and the tempo it set for it. */
const readout = () => page.evaluate(() => document.body.textContent?.match(/Pass (\d+) · (\d+) BPM/)?.slice(1).map(Number) ?? null)

const seen = []
const started = Date.now()
let stopped = false
// The whole ladder is a little over half a minute of music; sampled often enough to catch each
// pass's readout while it is up, and ended by the player stopping itself at the target.
while (Date.now() - started < 90_000) {
  await page.waitForTimeout(200)
  const shown = await readout()
  if (shown && (seen.length === 0 || seen[seen.length - 1][0] !== shown[0])) seen.push(shown)
  if (Date.now() - started > 3000 && !(await page.evaluate(() => !!document.body.textContent?.match(/⏸ Pause/)))) {
    stopped = true
    break
  }
}
const buffers = await page.evaluate(() => window.__buffers)
await page.close()
await browser.close()

console.log(`readout: ${seen.map(([p, bpm]) => `pass ${p} @ ${bpm} BPM`).join(', ')}`)
console.log(`buffers: [${buffers.map((d) => d.toFixed(3))}]`)

ok('the run ends by itself once the target is reached', stopped)
ok(`each pass renders its own buffer (${buffers.length} for ${LADDER.length} rungs)`, buffers.length === LADDER.length)
ok(
  `the readout counts the passes and names the ladder's tempos (${JSON.stringify(seen)})`,
  seen.length === LADDER.length && seen.every(([p, bpm], i) => p === i + 1 && bpm === LADDER[i]),
)

if (buffers.length === LADDER.length) {
  const music = buffers.map((d) => d - FADE_SEC)
  for (let i = 1; i < LADDER.length; i++) {
    const expected = (music[0] * LADDER[0]) / LADDER[i]
    console.log(`  pass ${i + 1}: ${music[i].toFixed(3)}s  expected ${expected.toFixed(3)}s at ${LADDER[i]} BPM`)
    ok(
      `pass ${i + 1} plays at ${LADDER[i]} BPM, not ${LADDER[0]} (${music[i].toFixed(3)}s vs ${expected.toFixed(3)}s)`,
      Math.abs(music[i] - expected) < 0.1,
    )
  }
}

console.log(failed ? 'speed trainer: FAILED' : 'speed trainer: passed')
process.exit(failed ? 1 : 0)
