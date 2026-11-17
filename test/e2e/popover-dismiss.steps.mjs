/**
 * Every popover in the editor closes on Escape and on a click outside it,
 * wherever the focus is.
 *
 * The report: "move to another note" on a recording opened the note picker, and
 * it could not be closed. It closed only on Escape while its own search field
 * had focus, and not on a click outside at all - so once the caret was back in
 * the note, nothing put it away. The slash menu and the calendar had the same
 * gap from the other side: they listened for Escape only in the note body.
 *
 * Closing the move picker must leave the recording exactly where it was, and a
 * transcription running at the time must still land.
 */

import { check } from './editor.mjs'

const escape = (page) => page.key(27, 'Escape', 'Escape')

/** Caret back in the note, the way a click on the text puts it there. */
const caretInBody = (page) =>
  page.eval(`
    const root = document.querySelector('.doc-body'); root.focus()
    const range = document.createRange(); range.selectNodeContents(root.querySelector('p')); range.collapse(false)
    getSelection().removeAllRanges(); getSelection().addRange(range)
    return document.activeElement === root`)

/** Focus somewhere that is neither the popover nor the note: the title field. */
const focusTitle = (page) =>
  page.eval(`
    const title = document.querySelector('.doc-title')
    title?.focus(); return document.activeElement?.tagName ?? 'none'`)

const open = (page, selector) => page.eval(`return document.querySelector('${selector}') !== null`)

export default async (page) => {
  await page.waitFor(`document.querySelector('.card') !== null`)
  await page.click('.card')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes('Start')`)

  // A real recording, with a tone in place of the microphone and the system capture.
  await page.eval(`
    const tone = () => { const ctx = new AudioContext(); const o = ctx.createOscillator(); const d = ctx.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream }
    navigator.mediaDevices.getUserMedia = async () => tone()
    navigator.mediaDevices.getDisplayMedia = async () => tone()
    return true`)
  await page.eval(`[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Record').click(); return true`)
  await page.waitFor(`document.querySelector('.record-go') !== null`)
  await page.click('.record-go')
  await page.waitFor(`document.querySelector('.recording-bar') !== null`, 'recording started')
  await page.sleep(2000)
  await page.click('.recording-stop')
  await page.waitFor(`document.querySelector('[data-recording] [data-move-note]') !== null`, 'recording block')
  const path = await page.eval(`return document.querySelector('[data-recording]').dataset.recording`)

  // --- The note picker, opened to move the recording.
  await page.click('[data-recording] [data-move-note]')
  await page.waitFor(`document.querySelector('.note-picker') !== null`, 'move picker')
  check((await caretInBody(page)) === true, 'the caret is back in the note, as in the report')
  await escape(page)
  check(!(await open(page, '.note-picker')), 'Escape closes the move picker with the caret in the note')

  await page.click('[data-recording] [data-move-note]')
  await page.waitFor(`document.querySelector('.note-picker') !== null`, 'move picker again')
  // Its left side: the picker opens under the control and covers the middle.
  await page.click('.doc-body > p', { x: -250, y: 0 })
  check(!(await open(page, '.note-picker')), 'a click outside closes the move picker')

  await page.click('[data-recording] [data-move-note]')
  await page.waitFor(`document.querySelector('.note-picker') !== null`, 'move picker a third time')
  await page.click('.note-picker-input')
  check(await open(page, '.note-picker'), 'a click inside the picker leaves it open')
  await escape(page)
  check(!(await open(page, '.note-picker')), 'Escape in its own field still closes it')

  const after = await page.eval(`
    const block = [...document.querySelectorAll('[data-recording]')]
    return { count: block.length, path: block[0]?.dataset.recording, exists: await window.nib.recordingExists(block[0]?.dataset.recording ?? '') }`)
  check(after.count === 1 && after.path === path && after.exists, 'the recording is where it was, file and all', JSON.stringify(after))

  // --- The slash menu: Escape with the focus outside the note, and a click outside.
  await caretInBody(page)
  await page.type(' /')
  await page.waitFor(`document.querySelector('.slash-menu') !== null`, 'slash menu')
  const focused = await focusTitle(page)
  await escape(page)
  check(!(await open(page, '.slash-menu')), `Escape closes the slash menu with the focus on ${focused}`)

  await caretInBody(page)
  await page.type(' /')
  await page.waitFor(`document.querySelector('.slash-menu') !== null`, 'slash menu again')
  await page.click('.doc-title')
  check(!(await open(page, '.slash-menu')), 'a click outside closes the slash menu')

  // --- The calendar, raised by /date.
  await caretInBody(page)
  await page.type(' /date')
  await page.waitFor(`document.querySelector('.slash-menu') !== null`, 'slash menu for date')
  await page.enter()
  await page.waitFor(`document.querySelector('.date-picker') !== null`, 'calendar')
  await page.click('.doc-title')
  check(!(await open(page, '.date-picker')), 'a click outside closes the calendar')

  await caretInBody(page)
  await page.type(' /date')
  await page.waitFor(`document.querySelector('.slash-menu') !== null`, 'slash menu for date again')
  await page.enter()
  await page.waitFor(`document.querySelector('.date-picker') !== null`, 'calendar again')
  await focusTitle(page)
  await escape(page)
  check(!(await open(page, '.date-picker')), 'Escape closes the calendar with the focus outside the note')

  // --- A transcription running while the move picker is opened and dismissed.
  const status = await page.eval(`return await window.nib.transcribeStatus('sv')`)
  if (!status.ready) {
    console.log(`  SKIPPED the transcription half: ${status.why}`)
    return
  }
  await page.click('[data-recording]', { x: -60, y: 0 })
  await page.waitFor(`document.querySelector('[data-recording]').dataset.state === 'working'`, 'transcribing')
  await page.click('[data-recording] [data-move-note]').catch(() => undefined)
  // While whisper runs the block shows progress text rather than its controls,
  // so the picker is opened from the last control there was, if it is there.
  const picked = await open(page, '.note-picker')
  if (picked) {
    await escape(page)
    check(!(await open(page, '.note-picker')), 'Escape closes the picker during a transcription')
  }
  await page.waitFor(
    `['transcribed', 'failed'].includes(document.querySelector('[data-recording]').dataset.state)`,
    'transcription finished',
    300
  )
  const done = await page.eval(`
    const b = document.querySelector('[data-recording]')
    return { state: b.dataset.state, path: b.dataset.recording, transcript: document.querySelector('[data-transcript]') !== null }`)
  check(done.state === 'transcribed' && done.transcript && done.path === path, 'the transcription landed on the recording, which did not move', JSON.stringify(done))
}
