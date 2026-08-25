import { chromium } from '@playwright/test'
const RATE = Number(process.argv[2] ?? 20)
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage()
await p.addInitScript(() => {
  window.__audioStart = null
  const orig = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (w, o, d) {
    if (this.buffer && this.buffer.duration > 5 && window.__audioStart === null) window.__audioStart = performance.now()
    return orig.call(this, w, o, d)
  }
})
await p.goto('http://localhost:5199/harness/', { waitUntil: 'networkidle' })
await p.waitForSelector('.sheet-music svg')
await p.evaluate(() => {
  window.__firstPaint = null; window.__firstNote = null
  const tick = () => {
    const hl = document.querySelector('.abcjs-note.highlight')
    if (hl && window.__firstPaint === null) {
      window.__firstPaint = performance.now()
      window.__firstNote = hl.getAttribute('class').match(/abcjs-n(\d+)/)?.[1] ?? '?'
    }
    requestAnimationFrame(tick)
  }
  tick()
})
const cdp = await p.context().newCDPSession(p)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE })
await p.getByRole('button', { name: /▶ Play/ }).click()
await p.waitForTimeout(7000)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
const r = await p.evaluate(() => ({ a: window.__audioStart, f: window.__firstPaint, n: window.__firstNote }))
const gap = Math.round(r.f - r.a)
console.log(`CPU ${RATE}x  audio@${Math.round(r.a)}ms  firstPaint@${Math.round(r.f)}ms  gap=${gap}ms  landedOnNote=${r.n}` +
            (gap <= 0 ? '   <- staff shown BEFORE sound' : '   <- sound before staff'))
await b.close()
