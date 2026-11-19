/**
 * Writing during a recording: the caret, comments under screenshots, and Mark.
 *
 * Two reports from the same meeting. The caret was gone when typing started:
 * Start is a button, a click focuses it, the record panel closed under it, and
 * the focus fell to the page - so the first words went nowhere. And times
 * appeared on lines nobody had marked: one press of Mark put `data-at` on a
 * line, every Enter after it cloned that line's attributes into the next, and
 * the next screenshot rebuilt the labels on all of them at once.
 *
 * The recording runs on a tone in place of the microphone and the system
 * capture. Start and the toolbar button are pressed with the pointer, as a
 * person does, because a click from script does not move the focus and would
 * not have shown the first bug at all.
 */

import { check } from './editor.mjs'

const marked = (page) =>
  page.eval(`return [...document.querySelectorAll('.doc-body p[data-at]')].map((p) => p.textContent.replace(/^\\d+:\\d\\d/, '').replace(/\\u200b/g, '') || '(image line)')`)
const labels = (page) => page.eval(`return document.querySelectorAll('.doc-body [data-at-label]').length`)
const images = (page) => page.eval(`return document.querySelectorAll('.doc-body img[data-at]').length`)

const paste = async (page, count) => {
  await page.eval(`
    const c = document.createElement('canvas'); c.width = 40; c.height = 30
    const g = c.getContext('2d'); g.fillStyle = '#d33'; g.fillRect(0, 0, 40, 30)
    const blob = await new Promise((done) => c.toBlob(done, 'image/png'))
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }))
    document.querySelector('.doc-body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    return true`)
  await page.waitFor(`document.querySelectorAll('.doc-body img[data-at]').length === ${count}`, `image ${count}`)
  await page.sleep(300)
}

/** Put the caret in the line whose words are `text`, right after its time label. */
const caretAfterLabel = (page, text) =>
  page.eval(`
    const line = [...document.querySelectorAll('.doc-body p')].find((p) => p.textContent.endsWith(${JSON.stringify(text)}))
    const r = document.createRange(); r.setStart(line, 1); r.collapse(true)
    getSelection().removeAllRanges(); getSelection().addRange(r); return true`)

export default async (page) => {
  await page.waitFor(`document.querySelector('.card') !== null`)
  await page.click('.card')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes('Start')`)
  await page.eval(`
    const tone = () => { const ctx = new AudioContext(); const o = ctx.createOscillator(); const d = ctx.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream }
    navigator.mediaDevices.getUserMedia = async () => tone()
    navigator.mediaDevices.getDisplayMedia = async () => tone()
    return true`)

  // --- The caret survives Start.
  await page.click('.doc-body p')
  await page.eval(`[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.trim() === 'Record').classList.add('e2e-record'); return true`)
  await page.click('.e2e-record')
  await page.waitFor(`document.querySelector('.record-go') !== null`, 'record panel')
  await page.click('.record-go')
  await page.waitFor(`document.querySelector('.recording-bar') !== null`, 'recording started')
  await page.sleep(500)
  const focus = await page.eval(`return document.activeElement?.className ?? ''`)
  check(focus.includes('doc-body'), 'after Start the note has the focus, not the page', focus)
  await page.type(' typed')
  const first = await page.eval(`return document.querySelector('.doc-body p').textContent`)
  check(first === 'Start typed', 'and the first words typed land in the note', first)

  // --- Comments under a screenshot carry no time.
  await page.enter()
  await paste(page, 1)
  await page.enter()
  await page.type('comment under the image')
  await page.enter()
  await page.type('second comment')
  await page.enter()
  await paste(page, 2)
  await page.enter()
  await page.type('comment under image two')
  check((await marked(page)).length === 0, 'no line written under a screenshot has a time', JSON.stringify(await marked(page)))
  check((await labels(page)) === (await images(page)), 'one label per screenshot, nothing else', `${await labels(page)} labels`)

  // --- One Mark marks one line, however many follow it.
  await page.click('.recording-mark')
  await page.enter()
  await page.type('after the mark')
  await page.enter()
  await paste(page, 3)
  await page.enter()
  await page.type('under image three')
  await page.enter()
  await page.type('and one more')
  const once = await marked(page)
  check(once.length === 1 && once[0] === 'comment under image two', 'Mark then Enter, Enter, a screenshot: only the marked line has a time', JSON.stringify(once))
  check((await labels(page)) === (await images(page)) + 1, 'labels: one per screenshot and one for the mark', `${await labels(page)} labels`)

  // --- Enter right after the label moves the words down, and the mark with them.
  await caretAfterLabel(page, 'comment under image two')
  await page.enter()
  const moved = await marked(page)
  check(moved.length === 1 && moved[0] === 'comment under image two', 'Enter at the start of a marked line keeps the mark on its words', JSON.stringify(moved))

  // --- Deleting the time takes the mark off.
  await caretAfterLabel(page, 'comment under image two')
  await page.key(8, 'Backspace', 'Backspace')
  await page.sleep(200)
  const left = await marked(page)
  check(left.length === 0, 'Backspace over a line\'s time unmarks the line', JSON.stringify(left))
  check((await labels(page)) === (await images(page)), 'and its label is gone', `${await labels(page)} labels`)

  await page.click('.recording-stop')
  await page.waitFor(`document.querySelector('.recording-bar') === null`, 'recording stopped')
  await page.sleep(300)
  const after = await page.eval(`return document.activeElement?.className ?? ''`)
  check(after.includes('doc-body'), 'after Stop the note still has the focus', after)
}
