import { chromium } from '@playwright/test'

/**
 * Do the interval trainer's two prompt notes actually sound one after the other?
 *
 * They did not, sometimes. Each note used to be its own abcjs playEvent, spaced only by
 * setTimeout, and every playEvent ends in source.start(0) — "play at the context's current render
 * position". That position doesn't move until the output device has finished opening, so on a cold
 * start all the notes landed on the same instant and played as a chord. It only showed on the first
 * prompt after a load, which is exactly the case a manual check is least likely to catch twice.
 *
 * This measures the rendered buffer rather than the code: one buffer per prompt, and two separated
 * bursts of energy inside it.
 */
const NOTE_MS = 900
const GAP_MS = 400

const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage()
await p.addInitScript(() => {
  window.__prompts = []
  const orig = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (w, o, d) {
    if (this.buffer && this.context instanceof AudioContext) {
      const ch = this.buffer.getChannelData(0)
      const rate = this.buffer.sampleRate
      // RMS per 25ms window, which is enough to see a note start without chasing single samples.
      const win = Math.floor(rate * 0.025)
      const rms = []
      for (let i = 0; i + win <= ch.length; i += win) {
        let sum = 0
        for (let j = i; j < i + win; j++) sum += ch[j] * ch[j]
        rms.push(Math.sqrt(sum / win))
      }
      const peak = Math.max(...rms)
      // An onset is a window that crosses a fifth of the peak having been quiet before it.
      const onsets = []
      let quiet = true
      for (let i = 0; i < rms.length; i++) {
        if (quiet && rms[i] > peak * 0.2) { onsets.push(i * 25); quiet = false }
        else if (!quiet && rms[i] < peak * 0.05) quiet = true
      }
      window.__prompts.push({
        dur: Math.round(this.buffer.duration * 1000),
        startedAt: +this.context.currentTime.toFixed(3),
        onsets,
      })
    }
    return orig.call(this, w, o, d)
  }
})

await p.goto('http://localhost:5199/practice/intervals', { waitUntil: 'networkidle' })
await p.getByRole('button', { name: /Start round/ }).click()
await p.waitForTimeout(6000)

const prompts = await p.evaluate(() => window.__prompts)
await b.close()

const ok = (l, c) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}`); return c }
let pass = true

if (prompts.length === 0) { console.log('FAIL  nothing captured'); process.exit(1) }
const first = prompts[0]
console.log(`first prompt: ${first.dur}ms buffer, onsets at ${first.onsets.join(', ')}ms`)

pass = ok('the whole prompt is one buffer, not a sound per note',
  prompts.length === 1) && pass
// abcjs appends its own fade (fadeLength, 200ms by default) past the last note, so the buffer
// runs a little longer than the music in it.
const musicMs = NOTE_MS * 2 + GAP_MS
pass = ok(`that buffer holds both notes and the gap (${first.dur}ms, want ${musicMs}\u2013${musicMs + 400})`,
  first.dur >= musicMs && first.dur <= musicMs + 400) && pass
pass = ok(`two separate notes sound in it (${first.onsets.length} onsets)`,
  first.onsets.length === 2) && pass
if (first.onsets.length === 2) {
  const apart = first.onsets[1] - first.onsets[0]
  pass = ok(`the second follows the first rather than joining it (${apart}ms apart, want ~${NOTE_MS + GAP_MS})`,
    Math.abs(apart - (NOTE_MS + GAP_MS)) < 200) && pass
}

process.exit(pass ? 0 : 1)
