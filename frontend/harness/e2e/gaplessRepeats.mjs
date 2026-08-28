import { chromium } from '@playwright/test'

/**
 * Do a tune's repetitions actually arrive as one continuous sound, without the lead-in?
 *
 * Repetitions used to be played by seeking one pass's buffer back to zero and starting it again,
 * which put an audible gap at every repeat and replayed the tune's lead-in each time — on The
 * Cowboy, whose `BA` sits outside the first repeat, two extra eighth notes a pass. Both faults are
 * invisible to a test that counts notes, and neither can be read off the code.
 *
 * So measure the rendered buffer instead. One buffer for the whole tune is what "no gap" means
 * here, and its length says exactly how many passes and how many lead-ins went into it.
 */
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ok = (label, pass) => { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`); if (!pass) failed = true }
let failed = false

/** Plays the probe `reps` times and reports every audio buffer the player rendered for it. */
async function render(reps) {
  const p = await browser.newPage()
  await p.addInitScript(() => {
    window.__buffers = []
    const orig = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (w, o, d) {
      // The metronome and clicked notes render their own short buffers; only the tune is long.
      if (this.buffer && this.buffer.duration > 3 && this.context instanceof AudioContext) {
        window.__buffers.push(this.buffer.duration)
      }
      return orig.call(this, w, o, d)
    }
  })
  await p.goto(`http://localhost:5199/harness/?probe=cowboy&reps=${reps}`, { waitUntil: 'networkidle' })
  await p.waitForSelector('.sheet-music svg')
  await p.getByRole('button', { name: /▶ Play/ }).click()
  // Long enough to prime and start; the buffer is fully rendered before a sample of it is heard,
  // so there is no need to sit through the tune.
  await p.waitForTimeout(6000)
  const buffers = await p.evaluate(() => window.__buffers)
  await p.close()
  return buffers
}

const one = await render(1)
const three = await render(3)
console.log(`buffers for 1 pass: [${one.map((d) => d.toFixed(3))}]`)
console.log(`buffers for 3 passes: [${three.map((d) => d.toFixed(3))}]`)

ok('one pass renders one buffer', one.length === 1)
ok('three passes still render one buffer, so nothing restarts mid-tune', three.length === 1)

if (one.length === 1 && three.length === 1) {
  // abcjs pads every buffer with the same fade tail, so it cancels out of the comparison once.
  const FADE_SEC = 0.2
  // The Cowboy is 6/8 at the harness's default tempo of one measure a second, and its lead-in is
  // two eighths — a third of a measure — which passes 2 and 3 do without.
  const LEAD_IN_SEC = 1 / 3
  const music1 = one[0] - FADE_SEC
  const music3 = three[0] - FADE_SEC
  const expected = music1 * 3 - LEAD_IN_SEC * 2
  console.log(`  one pass ${music1.toFixed(3)}s;  three ${music3.toFixed(3)}s;  expected ${expected.toFixed(3)}s`)
  ok(`three passes run three passes long (${music3.toFixed(3)}s vs ${expected.toFixed(3)}s)`, Math.abs(music3 - expected) < 0.05)
  ok(
    `the lead-in is dropped on the repeats, not replayed (${(music1 * 3 - music3).toFixed(3)}s shorter than three whole passes)`,
    Math.abs(music1 * 3 - music3 - LEAD_IN_SEC * 2) < 0.05,
  )
}

/**
 * The audio no longer restarts at a repeat, so the cursor going back to the top is the only thing
 * that still happens there — and where the lead-in is dropped, it has to land past it rather than at
 * the very start, or it spends the rest of the pass a lead-in behind the music.
 *
 * Both probes are four bars of 6/8 with no repeat marks of their own, so the only backward jumps are
 * the pass boundaries, and three passes take twelve seconds.
 */
async function watchPasses(probe, firstNoteOnRepeat) {
  const p = await browser.newPage()
  await p.goto(`http://localhost:5199/harness/?probe=${probe}&reps=3`, { waitUntil: 'networkidle' })
  await p.waitForSelector('.sheet-music svg')
  /** Which note on the staff is lit, counting from the start of the tune. -1 when none is. */
  const litNote = () =>
    p.evaluate(() => [...document.querySelectorAll('.abcjs-note')].findIndex((n) => n.classList.contains('highlight')))

  await p.getByRole('button', { name: /▶ Play/ }).click()
  let previous = -1
  let rewinds = 0
  let wentDark = 0
  let lowestAfterRewind = Infinity
  // Sampled well inside one note's length, so the first note of a repeat is never simply missed.
  for (let elapsed = 0; elapsed < 11500; elapsed += 80) {
    await p.waitForTimeout(80)
    const lit = await litNote()
    if (lit === -1) {
      // The first moments and the tail have no note sounding; anything in between is a dropped cursor.
      if (elapsed > 800 && elapsed < 11000) wentDark++
      continue
    }
    if (previous >= 0 && lit < previous) rewinds++
    if (rewinds > 0) lowestAfterRewind = Math.min(lowestAfterRewind, lit)
    previous = lit
  }
  await p.close()

  console.log(`${probe}: ${rewinds} rewinds, first note of a repeat ${lowestAfterRewind}`)
  ok(`${probe}: the cursor rewinds once per repeat and no more`, rewinds === 2)
  ok(`${probe}: the cursor stays on the music throughout${wentDark ? ` (dark for ${wentDark} samples)` : ''}`, wentDark === 0)
  ok(
    `${probe}: a repeat starts on note ${firstNoteOnRepeat}, where the audio does`,
    lowestAfterRewind === firstNoteOnRepeat,
  )
}

// Nothing to drop, so every pass starts at the very first note.
await watchPasses('jig', 0)
// Two lead-in notes the repeats skip, so passes 2 and 3 start on the third note.
await watchPasses('leadin', 2)

await browser.close()
process.exit(failed ? 1 : 0)
