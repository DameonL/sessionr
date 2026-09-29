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
 * Usage: node harness/e2e/countIn.mjs [reel|jig]
 */
const PROBE = process.argv[2] ?? 'reel'
/** A reel is counted in four, a jig in two — the dotted-quarter groups it is felt in. */
const EXPECTED_BEATS = { reel: 4, jig: 2 }[PROBE]
if (!EXPECTED_BEATS) {
  console.log(`FAIL  unknown probe "${PROBE}" (want reel or jig)`)
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
      const peak = Math.max(...rms, 0)
      const onsets = []
      let quiet = true
      for (let i = 0; i < rms.length; i++) {
        if (quiet && rms[i] > peak * 0.2) { onsets.push(i * 25); quiet = false }
        else if (!quiet && rms[i] < peak * 0.05) quiet = true
      }
      window.__bufs.push({
        kind: this.buffer.duration > 3 ? 'tune' : 'countin',
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
const count = bufs.find((x) => x.kind === 'countin')
const tune = bufs.find((x) => x.kind === 'tune')
if (!count || !tune) {
  console.log(`FAIL  nothing captured (count-in: ${!!count}, tune: ${!!tune})`)
  await b.close()
  process.exit(1)
}

const spacing = count.onsets.length > 1 ? count.onsets[1] - count.onsets[0] : 0
const barMs = spacing * EXPECTED_BEATS
const gap = tune.startedAt - count.startedAt
console.log(`${PROBE}: count-in buffer ${count.dur}ms, onsets at [${count.onsets}]`)
console.log(`  beat spacing ${spacing}ms → a bar is ${barMs}ms; tune started ${gap}ms after the count`)
console.log(`  numbers shown: ${seen.join(' ')}`)

let failed = false
const ok = (label, cond) => {
  if (!cond) failed = true
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`)
}
ok(`the whole count-in is one buffer (${bufs.filter((x) => x.kind === 'countin').length} short buffer(s))`,
   bufs.filter((x) => x.kind === 'countin').length === 1)
ok(`${EXPECTED_BEATS} clicks are heard (${count.onsets.length})`, count.onsets.length === EXPECTED_BEATS)
ok('the clicks are evenly spaced',
   count.onsets.every((on, i) => i === 0 || Math.abs(on - count.onsets[i - 1] - spacing) <= 25))
ok(`the tune starts a bar later (${gap}ms vs ${barMs}ms, ±80)`, Math.abs(gap - barMs) <= 80)
ok(`the numbers counted match the clicks (${seen.join(' ')})`,
   seen.join(' ') === Array.from({ length: EXPECTED_BEATS }, (_, i) => i + 1).join(' '))

await b.close()
process.exit(failed ? 1 : 0)
