import { chromium } from '@playwright/test'
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage()
const errors = []
p.on('pageerror', e => errors.push(e.message))
await p.goto('http://localhost:5199/harness/', { waitUntil: 'networkidle' })
await p.waitForSelector('.sheet-music svg')
const ok = (l, c) => console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`)
const btn = (n) => p.getByRole('button', { name: n })
const snap = () => p.evaluate(() => ({
  highlighted: document.querySelectorAll('.abcjs-note.highlight').length,
  abcMark: document.querySelector('.abc-source-note')?.textContent ?? null,
  caret: document.querySelectorAll('.abc-source-caret').length,
  cursorY2: Number(document.querySelector('.abcjs-cursor')?.getAttribute('y2') ?? 0),
}))

// Start in SHEET view, play, then switch to ABC mid-tune.
await btn(/▶ Play/).click()
await p.waitForTimeout(2000)
const inSheet = await snap()
ok(`playing in sheet view: staff cursor live (${JSON.stringify(inSheet)})`, inSheet.highlighted > 0 && inSheet.cursorY2 > 0)

await btn('🎼 Sheet').click()
await p.waitForTimeout(120)   // deliberately shorter than one note
const justSwitched = await snap()
ok(`switching to ABC mid-tune shows the cursor immediately (${JSON.stringify(justSwitched)})`,
   !!justSwitched.abcMark && justSwitched.caret === 1)

// It keeps moving.
const moved = []
for (let i = 0; i < 10; i++) { await p.waitForTimeout(200); const s = await snap(); if (s.abcMark && moved.at(-1) !== s.abcMark) moved.push(s.abcMark) }
ok(`ABC cursor keeps advancing after the switch (${moved.join(' ')})`, moved.length >= 3)

// Pause / resume.
await btn(/⏸ Pause/).click(); await p.waitForTimeout(400)
const paused = await snap()
await btn(/▶ Play/).click(); await p.waitForTimeout(700)
const resumed = await snap()
ok(`pause holds the cursor and resume moves it on (${paused.abcMark} → ${resumed.abcMark})`, !!paused.abcMark && !!resumed.abcMark)

// Stop clears both views.
await btn(/■ Stop/).click(); await p.waitForTimeout(400)
const stopped = await snap()
ok(`stop clears the ABC cursor (${JSON.stringify(stopped)})`, stopped.abcMark === null && stopped.caret === 0)
await btn('🔤 ABC').click(); await p.waitForTimeout(200)
ok('stop clears the staff highlight too', (await snap()).highlighted === 0)

console.log('\npage errors:', errors.length ? errors : 'none')
await b.close()
