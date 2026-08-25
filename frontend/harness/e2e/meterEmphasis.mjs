import { chromium } from '@playwright/test'

/**
 * Does the meter actually come through in the audio?
 *
 * Renders a tune of identical eighth notes twice — once with emphasis off, once with it on — and
 * compares the two buffers sample for sample. Emphasis changes volume and never timing, so the two
 * renders line up exactly and their ratio shows precisely where the weight was added, with no
 * onset detection to get wrong. Every note is the same pitch and length, so a ratio above 1 can
 * only have come from the meter.
 */
const PROBE = process.argv[2] ?? 'reel'
const PER_BAR = PROBE === 'jig' ? 6 : 8

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })

/** Plays the probe tune at the given emphasis and returns its 5ms RMS envelope. */
async function render(emphasis) {
  const p = await browser.newPage()
  await p.addInitScript(() => {
    // Sharp attack, quick decay, so each note's level is its own rather than the last note's tail.
    localStorage.setItem('sessionapp.midi-instruments', JSON.stringify({ melody: 0, chords: 0, bass: 0 }))
    window.__env = null
    const orig = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (w, o, d) {
      if (this.buffer && this.buffer.duration > 3 && this.context instanceof AudioContext && !window.__env) {
        const ch = this.buffer.getChannelData(0)
        const rate = this.buffer.sampleRate
        const win = Math.floor(rate * 0.005)
        const env = []
        for (let i = 0; i + win < ch.length; i += win) {
          let s = 0
          for (let j = i; j < i + win; j++) s += ch[j] * ch[j]
          env.push(Math.sqrt(s / win))
        }
        window.__env = { env, windowSec: win / rate }
        window.__primeMs = Math.round(performance.now() - window.__playAt)
      }
      return orig.call(this, w, o, d)
    }
  })
  await p.goto(`http://localhost:5199/harness/?probe=${PROBE}`, { waitUntil: 'networkidle' })
  await p.waitForSelector('.sheet-music svg')

  await p.getByRole('button', { name: /Advanced Controls/ }).click()
  await p.locator('label:has-text("Emphasis") input[type=range]').evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, emphasis)
  await p.waitForTimeout(400)

  await p.evaluate(() => { window.__playAt = performance.now() })
  await p.getByRole('button', { name: /▶ Play/ }).click()
  await p.waitForTimeout(9000)
  const out = await p.evaluate(() => ({ ...window.__env, primeMs: window.__primeMs }))
  await p.close()
  return out
}

const flat = await render(0)
const loud = await render(100)
if (!flat?.env || !loud?.env) { console.log('FAIL  no buffer captured'); await browser.close(); process.exit(1) }

const n = Math.min(flat.env.length, loud.env.length)
const floor = Math.max(...flat.env) * 0.05
const ratio = []
for (let i = 0; i < n; i++) ratio.push(flat.env[i] > floor ? loud.env[i] / flat.env[i] : null)

// The bar is the dominant period of the ratio. Find it by autocorrelation rather than assuming a
// tempo, so the check does not quietly depend on the default BPM.
const valid = ratio.map((r) => (r === null ? 0 : r - 1))
let bestPeriod = 0, bestScore = -Infinity
for (let period = 20; period < n / 3; period++) {
  let score = 0, count = 0
  for (let i = 0; i + period < n; i++) { score += valid[i] * valid[i + period]; count++ }
  score /= count
  if (score > bestScore) { bestScore = score; bestPeriod = period }
}
const barWindows = bestPeriod

// Fold the ratio into one bar and split it into note positions.
const buckets = Array.from({ length: PER_BAR }, () => [])
for (let i = 0; i < n; i++) {
  if (ratio[i] === null) continue
  const pos = Math.floor(((i % barWindows) / barWindows) * PER_BAR)
  buckets[pos].push(ratio[i])
}
const byPosition = buckets.map((b) => (b.length ? b.reduce((a, c) => a + c, 0) / b.length : 0))

console.log(`${PROBE}: bar = ${(barWindows * flat.windowSec).toFixed(2)}s;  prime+start ${flat.primeMs}ms (0%) / ${loud.primeMs}ms (100%)`)
console.log('  emphasis applied, by position in bar:', byPosition.map((v, i) => `${i}:${v.toFixed(2)}x`).join('  '))

const ok = (l, c) => console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}`)
const rangeDb = 20 * Math.log10(Math.max(...byPosition) / Math.min(...byPosition))
console.log(`  downbeat to off-beat: ${rangeDb.toFixed(1)} dB`)
const strongest = byPosition.indexOf(Math.max(...byPosition))
ok(`beat 1 gets the most weight (loudest position is ${strongest})`, strongest === 0)
if (PROBE === 'reel') {
  ok('beat 3 is lifted above beats 2 and 4', byPosition[4] > byPosition[2] && byPosition[4] > byPosition[6])
  ok('the counted beats are lifted above the off-beats',
     Math.min(byPosition[0], byPosition[2], byPosition[4], byPosition[6]) > Math.max(byPosition[1], byPosition[3], byPosition[5], byPosition[7]))
} else {
  ok('the second group is lifted', byPosition[3] > byPosition[1] && byPosition[3] > byPosition[2])
  ok('both group heads are lifted above the rest',
     Math.min(byPosition[0], byPosition[3]) > Math.max(byPosition[1], byPosition[2], byPosition[4], byPosition[5]))
}
// Below about 5 dB the lean is there on paper and inaudible in practice, which is exactly the
// trap an earlier set of multipliers fell into by clipping against abcjs's own beat accents.
ok('the lean is wide enough to hear (>5 dB)', rangeDb > 5)
await browser.close()
