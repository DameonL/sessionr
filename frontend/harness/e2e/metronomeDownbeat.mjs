import { chromium } from '@playwright/test'

/**
 * abcjs counts beats straight through the tune rather than restarting at each barline, so the old
 * `beatNumber === 1` test accented the second beat of the pass and never fired again. This counts
 * the accented clicks over a known number of bars.
 */
const PROBE = process.argv[2] ?? 'reel'
const BARS = 4
const BEATS_PER_BAR = PROBE === 'jig' ? 2 : 4

const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage()
await p.addInitScript(() => {
  window.__clicks = []
  // The metronome fires one-shot events; the accent is a different pitch from the rest.
  const origFetch = window.fetch
  window.fetch = origFetch
})
await p.goto(`http://localhost:5199/harness/?probe=${PROBE}`, { waitUntil: 'networkidle' })
await p.waitForSelector('.sheet-music svg')

// Hook playEvent by intercepting the one-shot buffers the metronome creates: they are short and
// land on a live context, unlike the tune's long buffer.
await p.evaluate(() => {
  window.__clicks = []
  const orig = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (w, o, d) {
    if (this.buffer && this.context instanceof AudioContext) {
      if (this.buffer.duration > 3) window.__tuneAt = performance.now()
      else {
        // The accent differs from the ordinary click by pitch, not length, so fingerprint the
        // waveform rather than the duration.
        const ch = this.buffer.getChannelData(0)
        let sig = 0
        for (let i = 0; i < Math.min(2000, ch.length); i++) sig += Math.abs(ch[i])
        window.__clicks.push({ t: Math.round(performance.now()), sig: Math.round(sig) })
      }
    }
    return orig.call(this, w, o, d)
  }
})

await p.getByRole('button', { name: /Advanced Controls/ }).click()
await p.waitForTimeout(200)
await p.getByRole('button', { name: /Metronome/i }).first().click()
await p.waitForTimeout(300)
await p.getByRole('button', { name: /▶ Play/ }).click()
await p.waitForTimeout(9000)

const { clicks, tuneAt } = await p.evaluate(() => ({ clicks: window.__clicks, tuneAt: window.__tuneAt }))
const during = clicks.filter((c) => tuneAt && c.t >= tuneAt - 200)
// The accent uses a different pitch, which renders as a distinct buffer duration.
const bySig = {}
for (const c of during) bySig[c.sig] = (bySig[c.sig] ?? 0) + 1
console.log(`${PROBE}: ${during.length} clicks over ${BARS} bars (expect ~${BARS * BEATS_PER_BAR})`)
console.log('  clicks by waveform fingerprint:', JSON.stringify(bySig))
const counts = Object.values(bySig)
const accents = counts.length < 2 ? during.length : Math.min(...counts)
const ok = (l, c) => console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}`)
ok(`one accent per bar, not one per pass (${accents} accents for ${BARS} bars)`, accents >= BARS - 1 && accents <= BARS + 1)
ok('there are more ordinary clicks than accents', during.length - accents > accents)
await b.close()
