import { chromium } from '@playwright/test'

/**
 * Does Play count a bar in before the tune, and does the number on screen match what is heard?
 *
 * Two things this measures that reading the code cannot. First, the clicks have to be *inside one
 * rendered buffer*: separately scheduled clicks all land on the same instant when the output
 * device opens late, which is precisely the cold start a count-in happens on. Second, the tune has
 * to begin a bar after the count started — not a click's length short of it, which is what timing
 * off the count-in buffer's own duration would give, since the silence after the last click is
 * never rendered.
 *
 * Usage: node harness/e2e/countIn.mjs [reel|jig|slide]
 */
const PROBE = process.argv[2] ?? 'reel'
/**
 * The bar as written — a reel in four, a jig in six — except past 6/8, where a slide's twelve
 * eighths are counted as their four dotted-quarter groups instead.
 */
const EXPECTED_BEATS = { reel: 4, jig: 6, slide: 4 }[PROBE]
if (!EXPECTED_BEATS) {
  console.log(`FAIL  unknown probe "${PROBE}" (want reel, jig or slide)`)
  process.exit(1)
}

const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage()
await p.addInitScript(() => {
  window.__bufs = []
  const orig = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (w, o, d) {
    if (this.buffer && this.context instanceof AudioContext) {
      const ch = this.buffer.getChannelData(0)
      const rate = this.buffer.sampleRate
      // RMS per 25ms window: enough to see a click start without chasing single samples.
      const win = Math.floor(rate * 0.025)
      const rms = []
      for (let i = 0; i + win <= ch.length; i += win) {
        let sum = 0
        for (let j = i; j < i + win; j++) sum += ch[j] * ch[j]
        rms.push(Math.sqrt(sum / win))
      }
      // A click is a window over a fifth of the peak, with a 100ms refractory after it — long
      // enough that the side stick's own second peak isn't counted as another click, and still
      // well short of the 167ms between the six beats of a jig bar. Waiting
      // for the level to fall back to near silence between clicks, as the interval-prompt check
      // can, would miss most of a count-in: a side stick is still ringing 167ms later, which is
      // all the space there is between the six beats of a jig bar.
      const peak = Math.max(...rms, 0)
      const onsets = []
      for (let i = 0; i < rms.length; i++) {
        const at = i * 25
        if (rms[i] > peak * 0.2 && (onsets.length === 0 || at - onsets.at(-1) >= 100)) onsets.push(at)
      }
      window.__bufs.push({
        dur: Math.round(this.buffer.duration * 1000),
        startedAt: Math.round(this.context.currentTime * 1000),
        onsets,
      })
    }
    return orig.call(this, w, o, d)
  }
})
await p.goto(`http://localhost:5199/harness/?probe=${PROBE}`, { waitUntil: 'networkidle' })
await p.waitForSelector('.sheet-music svg')

// Every distinct number the overlay shows, in the order it shows them.
await p.evaluate(() => {
  window.__seen = []
  const tick = () => {
    const el = document.querySelector('.count-in-number')
    const text = el?.textContent?.trim()
    if (text && window.__seen.at(-1) !== text) window.__seen.push(text)
    requestAnimationFrame(tick)
  }
  tick()
})

await p.getByRole('button', { name: /▶ Play/ }).click()
await p.waitForTimeout(8000)

const { bufs, seen } = await p.evaluate(() => ({ bufs: window.__bufs, seen: window.__seen }))
/*
 * Priming a synth starts its buffers at context time zero, whoever built it, so those renders are
 * not sounds anyone hears and are no part of what this measures. Everything actually played is
 * held back by waitForAudioClock until the context's clock is running, so a real start is always
 * at a time past zero.
 */
const played = bufs.filter((x) => x.startedAt > 0)
const tune = played.find((x) => x.dur > 3000)
const beforeTune = played.filter((x) => x.startedAt < (tune?.startedAt ?? Infinity))
const count = beforeTune.at(-1)
if (!count || !tune) {
  console.log(`FAIL  nothing captured (count-in: ${!!count}, tune: ${!!tune})`)
  await b.close()
  process.exit(1)
}

// Averaged across the whole count rather than taken from the first gap: the 25ms analysis window
// quantizes each onset, which on its own is a 10% error on a jig's 167ms beat.
const spacing =
  count.onsets.length > 1 ? (count.onsets.at(-1) - count.onsets[0]) / (count.onsets.length - 1) : 0
const barMs = Math.round(spacing * EXPECTED_BEATS)
const gap = tune.startedAt - count.startedAt
console.log(`${PROBE}: count-in buffer ${count.dur}ms, onsets at [${count.onsets}]`)
console.log(`  beat spacing ${Math.round(spacing)}ms → a bar is ${barMs}ms; tune started ${gap}ms after the count`)
console.log(`  numbers shown: ${seen.join(' ')}`)

let failed = false
const ok = (label, cond) => {
  if (!cond) failed = true
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`)
}
ok(`the whole count-in is one buffer (${beforeTune.length} sounded before the tune)`,
   beforeTune.length === 1)
ok(`${EXPECTED_BEATS} clicks are heard (${count.onsets.length})`, count.onsets.length === EXPECTED_BEATS)
ok('the clicks are evenly spaced',
   count.onsets.every((on, i) => i === 0 || Math.abs(on - count.onsets[i - 1] - spacing) <= 25))
ok(`the tune starts a bar later (${gap}ms vs ${barMs}ms, ±80)`, Math.abs(gap - barMs) <= 80)
ok(`the numbers counted match the clicks (${seen.join(' ')})`,
   seen.join(' ') === Array.from({ length: EXPECTED_BEATS }, (_, i) => i + 1).join(' '))

await b.close()
process.exit(failed ? 1 : 0)
