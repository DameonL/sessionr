import { chromium } from '@playwright/test'

/**
 * Verifies that SetPlayer recovers without a page refresh when the shared AudioContext is
 * suspended or closed while the app sits open, covering both Play-from-stopped and
 * Play-from-paused (resume).
 */
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage()
const errors = []
p.on('pageerror', (e) => errors.push(e.message))

await p.addInitScript(() => {
  window.__tuneStarts = 0
  const orig = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (w, o, d) {
    if (this.buffer && this.buffer.duration > 5) {
      window.__tuneStarts += 1
    }
    return orig.call(this, w, o, d)
  }
})

await p.goto('http://localhost:5199/harness/', { waitUntil: 'networkidle' })
await p.waitForSelector('.sheet-music svg')

const btn = (n) => p.getByRole('button', { name: n })
const ok = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  return cond
}
const snap = () =>
  p.evaluate(() => ({
    starts: window.__tuneStarts,
    ctxState: window.abcjsAudioContext?.state ?? null,
    highlighted: document.querySelectorAll('.abcjs-note.highlight').length,
    errorText: document.querySelector('.error')?.textContent ?? null,
  }))

let pass = true

// 1. Initial Play.
await btn(/▶ Play/).click()
await p.waitForSelector('button:has-text("⏸ Pause")')
await p.waitForTimeout(2500)
const initial = await snap()
pass =
  ok(
    `initial play succeeds (${JSON.stringify(initial)})`,
    initial.starts >= 1 && initial.ctxState === 'running' && initial.highlighted > 0 && !initial.errorText,
  ) && pass

// 2. Stop, suspend AudioContext (simulating long background/idle), then Play again without refresh.
await btn(/■ Stop/).click()
await p.evaluate(async () => {
  window.__prevCtx = window.abcjsAudioContext
  await window.abcjsAudioContext.suspend()
})
const suspendedState = await p.evaluate(() => window.abcjsAudioContext?.state)
pass = ok(`AudioContext suspended (${suspendedState})`, suspendedState === 'suspended') && pass

const startsBeforeResumePlay = initial.starts
await btn(/▶ Play/).click()
await p.waitForSelector('button:has-text("⏸ Pause")')
await p.waitForTimeout(2500)
const afterSuspend = await snap()
pass =
  ok(
    `play recovers from suspended AudioContext (${JSON.stringify(afterSuspend)})`,
    afterSuspend.starts > startsBeforeResumePlay &&
      afterSuspend.ctxState === 'running' &&
      afterSuspend.highlighted > 0 &&
      !afterSuspend.errorText,
  ) && pass

// 3. Stop, close AudioContext (simulating torn-down audio session), then Play again without refresh.
await btn(/■ Stop/).click()
await p.evaluate(async () => {
  await window.abcjsAudioContext.close()
})
const closedState = await p.evaluate(() => window.abcjsAudioContext?.state)
pass = ok(`AudioContext closed (${closedState})`, closedState === 'closed') && pass

const startsBeforeClosedPlay = afterSuspend.starts
await btn(/▶ Play/).click()
await p.waitForSelector('button:has-text("⏸ Pause")')
await p.waitForTimeout(2500)
const afterClose = await p.evaluate(() => ({
  starts: window.__tuneStarts,
  ctxState: window.abcjsAudioContext?.state ?? null,
  ctxReplaced: window.abcjsAudioContext !== window.__prevCtx,
  highlighted: document.querySelectorAll('.abcjs-note.highlight').length,
  errorText: document.querySelector('.error')?.textContent ?? null,
}))
pass =
  ok(
    `play recovers from closed AudioContext with fresh context (${JSON.stringify(afterClose)})`,
    afterClose.ctxReplaced &&
      afterClose.starts > startsBeforeClosedPlay &&
      afterClose.ctxState === 'running' &&
      afterClose.highlighted > 0 &&
      !afterClose.errorText,
  ) && pass

// 4. Pause, suspend AudioContext while paused, then Play (resume path) without refresh.
await btn(/⏸ Pause/).click()
await p.waitForSelector('button:has-text("▶ Play")')
await p.evaluate(async () => {
  await window.abcjsAudioContext.suspend()
})
const startsBeforePauseResume = afterClose.starts
await btn(/▶ Play/).click()
await p.waitForSelector('button:has-text("⏸ Pause")')
await p.waitForTimeout(1000)
const afterPauseResume = await snap()
pass =
  ok(
    `resume recovers from suspended AudioContext while paused (${JSON.stringify(afterPauseResume)})`,
    afterPauseResume.starts > startsBeforePauseResume &&
      afterPauseResume.ctxState === 'running' &&
      afterPauseResume.highlighted > 0 &&
      !afterPauseResume.errorText,
  ) && pass

pass = ok(`no page errors (${errors.length ? errors.join('; ') : 'none'})`, errors.length === 0) && pass

await b.close()
process.exit(pass ? 0 : 1)
