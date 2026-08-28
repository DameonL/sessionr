import { chromium } from '@playwright/test'

/**
 * Does the cursor actually sit on the note being played?
 *
 * The cursor and the audio run on unrelated clocks, and the player reconciles them by subtracting
 * the audio that earlier passes already used. Everything that decides how long a pass is therefore
 * has to describe the buffer that is really sounding — and it has been wrong twice: once by scaling
 * a tune length that had already been scaled, and once by recomputing pass lengths for a tempo the
 * buffer had not been rebuilt at. Both put the cursor seconds away from the music within a few
 * passes, and neither is visible from the code or to a test that only checks a note is lit.
 *
 * So measure it. The probe is four bars of 6/8 in identical eighth notes with a two-note lead-in the
 * repeats drop, so a note index converts straight to a time, and the tempo is read off the rendered
 * buffer rather than off the label — a drag moves the label without rebuilding anything, and
 * measuring against the label would blame the player for the probe's own wrong assumption.
 */
const NOTE_SEC = 1 / 6            // 6/8 at one bar a second
const LEAD_IN_NOTES = 2
const PASSES = 4
const PASS1_SEC = 26 * NOTE_SEC   // lead-in + 24 notes
const PASS_SEC = 24 * NOTE_SEC    // the repeats drop the lead-in
const FADE_SEC = 0.2              // abcjs pads every buffer with the same tail

/**
 * Under a note at this tempo, and an order of magnitude under the faults this exists to catch, which
 * ran to whole seconds. Loose enough that a loaded machine's sampling jitter — worth tens of
 * milliseconds on its own — doesn't turn it into a coin toss.
 */
const MAX_DRIFT_MS = 100

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ok = (label, pass) => { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`); if (!pass) failed = true }
let failed = false

/**
 * Plays the probe and samples the audio clock and the lit note together.
 *
 * `when` says how the tempo change is made: `before` play, `during` it, `drag` for a slider held
 * down and never released (the tempo label moves but nothing is rebuilt, which is the state the
 * player is in throughout every drag), or `replay` for a second play at the same tempo.
 */
async function measure(tempoFactor, when) {
  const p = await browser.newPage()
  await p.addInitScript(() => {
    // Where the tune's buffer started, and how long it is, so both can be read from the page.
    const orig = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (w, o, d) {
      if (this.buffer && this.buffer.duration > 6 && this.context instanceof AudioContext) {
        window.__gen = (window.__gen ?? 0) + 1
        window.__audio = { ctx: this.context, t0: this.context.currentTime, offset: o ?? 0, gen: window.__gen, dur: this.buffer.duration }
      }
      return orig.call(this, w, o, d)
    }
  })
  await p.goto(`http://localhost:5199/harness/?probe=leadin&reps=${PASSES}`, { waitUntil: 'networkidle' })
  await p.waitForSelector('.sheet-music svg')
  await p.getByRole('button', { name: /Advanced Controls/ }).click()

  const setTempo = () =>
    p.locator('label:has-text("Tempo") input[type=range]').evaluate((el, [factor, dragOnly]) => {
      const v = Math.round(Number(el.value) * factor)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v))
      el.dispatchEvent(new Event('input', { bubbles: true }))
      // A real drag reports 'input' on every step and 'change' only on release.
      if (!dragOnly) el.dispatchEvent(new Event('change', { bubbles: true }))
    }, [tempoFactor, when === 'drag'])

  if ((when === 'before' || when === 'replay') && tempoFactor !== 1) {
    await setTempo()
    await p.waitForTimeout(900)
  }
  if (when === 'replay') {
    // A second play at a tempo that is not the tune's own: by then the synths have re-timed the
    // tune, so anything that reads a tune length back without saying which tempo it wants gets a
    // length that has already been converted once.
    await p.getByRole('button', { name: /▶ Play/ }).click()
    await p.waitForTimeout(2500)
    await p.getByRole('button', { name: /■ Stop/ }).click()
    await p.waitForTimeout(400)
  }

  await p.getByRole('button', { name: /▶ Play/ }).click()
  if (when === 'during' || when === 'drag') {
    await p.waitForTimeout(2500)
    await setTempo()
    await p.waitForTimeout(1500)
  }

  const rows = []
  const started = Date.now()
  while (Date.now() - started < 19000) {
    await p.waitForTimeout(120)
    const row = await p.evaluate(() => {
      const a = window.__audio
      return {
        audioSec: a ? a.ctx.currentTime - a.t0 + a.offset : null,
        sinceStart: a ? a.ctx.currentTime - a.t0 : 0,
        bufSec: a ? a.dur : 0,
        gen: a ? a.gen : 0,
        playing: !!document.body.textContent.match(/⏸ Pause/),
        lit: [...document.querySelectorAll('.abcjs-note')].findIndex((n) => n.classList.contains('highlight')),
      }
    })
    rows.push(row)
    if (!row.playing && Date.now() - started > 3000) break
  }
  await p.close()
  return rows
}

/** Where the cursor should be, in notes, for a given moment of audio. */
function expectedNote(audioSec, scale) {
  const first = PASS1_SEC * scale
  if (audioSec < first) return audioSec / (NOTE_SEC * scale)
  return LEAD_IN_NOTES + ((audioSec - first) % (PASS_SEC * scale)) / (NOTE_SEC * scale)
}

for (const [factor, when] of [[1, 'before'], [1.25, 'before'], [1.25, 'replay'], [1.25, 'during'], [1.25, 'drag']]) {
  const rows = await measure(factor, when)
  // Only the buffer playing now: a rebuild leaves earlier samples measured against a clock that has
  // since been replaced, and the first second of a new one is still settling.
  const gen = Math.max(...rows.map((r) => r.gen))
  const live = rows.filter((r) => r.gen === gen && r.playing && r.lit >= 0 && r.audioSec !== null && r.sinceStart >= 1)
  const scale = (Math.max(...rows.map((r) => r.bufSec)) - FADE_SEC) / (PASS1_SEC + (PASSES - 1) * PASS_SEC)

  const byPass = {}
  for (const { audioSec, lit } of live) {
    const pass = audioSec < PASS1_SEC * scale ? 1 : Math.floor((audioSec - PASS1_SEC * scale) / (PASS_SEC * scale)) + 2
    // lit is the note that most recently started, so a half note is added to centre the comparison.
    ;(byPass[pass] ??= []).push((lit + 0.5 - expectedNote(audioSec, scale)) * NOTE_SEC * scale * 1000)
  }

  // Median, not mean: a sample taken in the moment between the audio crossing into the next pass
  // and the cursor rewinding reads a whole pass out, and one such sample would drag an average
  // across the threshold on its own.
  const median = (ds) => [...ds].sort((a, b) => a - b)[Math.floor(ds.length / 2)]
  const drifts = Object.entries(byPass)
    .filter(([, ds]) => ds.length >= 4)
    .map(([pass, ds]) => [Number(pass), median(ds)])
  const worst = drifts.reduce((w, [, d]) => Math.max(w, Math.abs(d)), 0)

  const label = `tempo x${factor} ${when} play (buffer ${(120 / scale).toFixed(0)} BPM)`
  console.log(`${label}: ${drifts.map(([n, d]) => `pass ${n} ${d >= 0 ? '+' : ''}${d.toFixed(0)}ms`).join('  ')}`)
  ok(`${label}: cursor stays on the note through every pass (worst ${worst.toFixed(0)}ms)`, drifts.length >= 3 && worst < MAX_DRIFT_MS)
}

await browser.close()
process.exit(failed ? 1 : 0)
