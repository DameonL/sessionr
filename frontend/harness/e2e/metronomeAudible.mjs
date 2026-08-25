import { chromium } from '@playwright/test'

/**
 * Is the metronome actually audible against the tune?
 *
 * It was not: the default click was a closed hi-hat, whose sample peaks about 15 dB below a tune
 * playing at the same time. Nothing in the code said so — it took measuring the rendered buffers to
 * see it. This keeps a future change to the default sound or velocity from quietly undoing that.
 */
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage()
await p.addInitScript(() => {
  window.__bufs = []
  const orig = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (w, o, d) {
    if (this.buffer && this.context instanceof AudioContext) {
      const ch = this.buffer.getChannelData(0)
      let peak = 0, sum = 0
      for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; sum += ch[i] * ch[i] }
      window.__bufs.push({
        kind: this.buffer.duration > 3 ? 'tune' : 'click',
        dur: +this.buffer.duration.toFixed(3),
        peak: +peak.toFixed(4),
        rms: +Math.sqrt(sum / ch.length).toFixed(4),
      })
    }
    return orig.call(this, w, o, d)
  }
})
await p.goto('http://localhost:5199/harness/?probe=reel', { waitUntil: 'networkidle' })
await p.waitForSelector('.sheet-music svg')
await p.getByRole('button', { name: /Advanced Controls/ }).click()
await p.waitForTimeout(200)
await p.getByRole('button', { name: /Metronome/i }).first().click()
await p.waitForTimeout(300)
await p.getByRole('button', { name: /▶ Play/ }).click()
await p.waitForTimeout(7000)
const bufs = await p.evaluate(() => window.__bufs)
const tune = bufs.filter((x) => x.kind === 'tune')[0]
const clicks = bufs.filter((x) => x.kind === 'click')
if (!tune || clicks.length < 4) { console.log('FAIL  nothing captured'); await b.close(); process.exit(1) }

const peaks = [...new Set(clicks.map((c) => c.peak))].sort((a, c) => a - c)
const db = (v) => 20 * Math.log10(v / tune.peak)
const ordinary = peaks[0]
const accent = peaks.at(-1)
console.log(`tune peak ${tune.peak}`)
console.log(`  ordinary click ${ordinary}  ${db(ordinary).toFixed(1)} dB vs tune`)
console.log(`  downbeat click ${accent}  ${db(accent).toFixed(1)} dB vs tune`)

const ok = (l, c) => console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}`)
ok(`ordinary beats carry over the tune (${db(ordinary).toFixed(1)} dB, want > -3)`, db(ordinary) > -3)
ok(`without drowning it (${db(ordinary).toFixed(1)} dB, want < 10)`, db(ordinary) < 10)
ok(`the downbeat stands out from the rest (${(db(accent) - db(ordinary)).toFixed(1)} dB louder)`,
   db(accent) - db(ordinary) > 1)
await b.close()
