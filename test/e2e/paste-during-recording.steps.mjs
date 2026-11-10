/**
 * A picture pasted during a recording: it and its timestamp go in as one, and
 * the caret lands after both.
 *
 * The report: the caret ended up between the picture and its own timestamp, so
 * Enter and the next paste put the second picture in front of the first one's
 * time. Pasted twice with Enter in between, the note must read image 1,
 * timestamp 1, image 2, timestamp 2, on two lines. And a paste outside a
 * recording must stay exactly as it was.
 *
 * The microphone and the system capture are replaced by a tone, in the page, so
 * a real recording runs without any device.
 */

import { check } from './editor.mjs'

export default async (page) => {
  const html = () => page.eval(`return document.querySelector('.doc-body').innerHTML`)
  const caret = () =>
    page.eval(`
      const s = getSelection(); if (!s.rangeCount) return 'none'
      const r = s.getRangeAt(0); const n = r.startContainer
      const kids = n.childNodes ? [...n.childNodes] : []
      const before = kids[r.startOffset - 1], after = kids[r.startOffset]
      const d = (x) => !x ? '-' : x.nodeType === 3 ? JSON.stringify(x.textContent) : x.tagName + (x.dataset?.atLabel ? '[label]' : x.dataset?.at ? '[at]' : '')
      return n.nodeName + '@' + r.startOffset + ' between ' + d(before) + ' and ' + d(after)`)
  const paste = (color) =>
    page.eval(`
      const c = document.createElement('canvas'); c.width = 40; c.height = 30
      const g = c.getContext('2d'); g.fillStyle = '${color}'; g.fillRect(0, 0, 40, 30)
      const blob = await new Promise((done) => c.toBlob(done, 'image/png'))
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }))
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      document.querySelector('.doc-body').dispatchEvent(ev)
      return true`)

  await page.waitFor(`document.querySelector('.card') !== null`)
  await page.click('.card')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes('Start')`)

  // A recording with synthetic audio in place of the microphone and the system capture.
  await page.eval(`
    const tone = () => { const ctx = new AudioContext(); const o = ctx.createOscillator(); const d = ctx.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream }
    navigator.mediaDevices.getUserMedia = async () => tone()
    navigator.mediaDevices.getDisplayMedia = async () => tone()
    return true`)
  await page.eval(`[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Record').click(); return true`)
  await page.waitFor(`document.querySelector('.record-go') !== null`)
  await page.click('.record-go')
  await page.waitFor(`document.querySelector('.recording-bar') !== null`, 'recording started')
  await page.sleep(1500)

  // Caret on a fresh line after "Start".
  await page.eval(`
    const el = document.querySelector('.doc-body > p'); document.querySelector('.doc-body').focus()
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false)
    getSelection().removeAllRanges(); getSelection().addRange(r); return true`)
  await page.enter()

  await paste('#d33')
  await page.waitFor(`document.querySelectorAll('.doc-body img[data-at]').length === 1`, 'first image')
  await page.sleep(300)
  const afterFirst = await caret()
  console.log('    caret after paste 1:', afterFirst)
  console.log('    html:', await html())
  const pastLabel = await page.eval(`
    const label = document.querySelector('.doc-body [data-at-label]')
    const r = getSelection().getRangeAt(0)
    const after = document.createRange(); after.setStartAfter(label)
    return r.collapsed && r.compareBoundaryPoints(Range.START_TO_START, after) >= 0 && label.parentElement.contains(r.startContainer)`)
  check(pastLabel, 'after a paste the caret is after the timestamp, on the same line', afterFirst)

  await page.enter()
  await page.sleep(200)
  await paste('#33d')
  await page.waitFor(`document.querySelectorAll('.doc-body img[data-at]').length === 2`, 'second image')
  await page.sleep(300)
  console.log('    caret after paste 2:', await caret())
  const order = await page.eval(`
    return [...document.querySelectorAll('.doc-body img[data-at], .doc-body [data-at-label]')].map((n) => n.tagName === 'IMG' ? 'image' : 'timestamp')`)
  const lines = await page.eval(`
    return [...document.querySelectorAll('.doc-body img[data-at]')].map((img) => img.parentElement === img.nextElementSibling?.parentElement && img.nextElementSibling?.dataset.atLabel === '1')`)
  console.log('    order:', order.join(', '), '| html:', await html())
  check(order.join(',') === 'image,timestamp,image,timestamp', 'image 1, timestamp 1, image 2, timestamp 2', order.join(','))
  check(lines.every(Boolean), 'each timestamp sits right after its own image')
  const separate = await page.eval(`const imgs = [...document.querySelectorAll('.doc-body img[data-at]')]; return imgs[0].closest('p') !== imgs[1].closest('p')`)
  check(separate, 'the two pictures are on separate lines after Enter')

  await page.eval(`document.querySelector('.recording-bar button:last-of-type')?.click(); return true`)
  await page.sleep(500)

  // Outside a recording nothing changes: the picture, no label, the caret after it.
  await page.waitFor(`document.querySelector('.recording-bar') === null`, 'recording stopped')
  await page.eval(`document.querySelector('.doc-body').innerHTML = '<p>Start</p>'; return true`)
  await page.eval(`
    const el = document.querySelector('.doc-body > p'); document.querySelector('.doc-body').focus()
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false)
    getSelection().removeAllRanges(); getSelection().addRange(r); return true`)
  await page.enter()
  await page.eval(`
    const c = document.createElement('canvas'); c.width = 40; c.height = 30
    const g = c.getContext('2d'); g.fillStyle = '#3d3'; g.fillRect(0, 0, 40, 30)
    const blob = await new Promise((done) => c.toBlob(done, 'image/png'))
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }))
    document.querySelector('.doc-body').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    return true`)
  await page.waitFor(`document.querySelectorAll('.doc-body img').length === 1`, 'image pasted')
  await page.sleep(300)
  await page.type('after')
  const plain = await page.eval(`return document.querySelector('.doc-body').innerHTML`)
  console.log('    plain paste:', plain)
  check(!/data-at|data-at-label/.test(plain), 'a paste outside a recording carries no time and no label', plain)
  check(/<img[^>]*>after<\/p>/.test(plain), 'and the caret is after the picture', plain)
}
