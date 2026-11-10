/**
 * A checklist is indented like a bullet list: the box starts where the bullet
 * does, at every level of nesting. Measured, not eyeballed.
 *
 * A list marker is not in the DOM - neither a bullet nor the box can be asked
 * for its rectangle - so the page is screenshotted and the strip in front of
 * each item's text is scanned for the first pixel that is not background. The
 * PNG is decoded here with zlib, so the check needs nothing installed.
 *
 * The report it guards: the first box was drawn flush with the paragraph text,
 * 1px in, where a bullet starts 5px in - so a checklist read as not indented at
 * all, although its text was exactly where a bullet list's is.
 */

import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { check, openNote } from './editor.mjs'

const LISTS =
  '<p>Paragraph text</p>' +
  '<ul><li>Bullet<ul><li>Bullet nested<ul><li>Bullet deep</li></ul></li></ul></li></ul>' +
  '<ol><li>Number<ol><li>Number nested</li></ol></li></ol>' +
  '<ul><li data-task="open">Task<ul><li data-task="done">Task nested<ul><li data-task="open">Task deep</li></ul></li></ul></li></ul>'

const SHOT = join(tmpdir(), `nib-e2e-indent-${process.pid}.png`)

function decodePng(path) {
  const buf = readFileSync(path)
  let pos = 8, width = 0, height = 0, colorType = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9] }
    if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]
      const a = x >= bpp ? out[y * stride + x - bpp] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0
      let p = v
      if (f === 1) p = v + a
      else if (f === 2) p = v + b
      else if (f === 3) p = v + ((a + b) >> 1)
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) }
      out[y * stride + x] = p & 255
    }
  }
  return { width, height, at: (x, y) => { const i = y * stride + x * bpp; return [out[i], out[i + 1], out[i + 2]] } }
}

export default async (page) => {
  await openNote(page)
  await page.eval(`document.querySelector('.doc-body').innerHTML = ${JSON.stringify(LISTS)}; return true`)
  await page.sleep(300)
  const geo = await page.eval(`
    const dpr = devicePixelRatio
    const p = document.querySelector('.doc-body > p')
    const range = document.createRange(); range.selectNodeContents(p)
    const textLeft = range.getBoundingClientRect().left
    const rows = [...document.querySelectorAll('.doc-body li')].map((li) => {
      const r = li.getBoundingClientRect()
      const own = document.createRange(); own.setStart(li.firstChild, 0); own.setEnd(li.firstChild, li.firstChild.length)
      const t = own.getBoundingClientRect()
      return { name: li.firstChild.textContent, left: r.left, textLeft: t.left, top: t.top, bottom: t.bottom }
    })
    return { dpr, textLeft, rows, bodyLeft: document.querySelector('.doc-body').getBoundingClientRect().left }`)
  await page.shot(SHOT)
  const img = decodePng(SHOT)
  const s = geo.dpr
  const bg = img.at(Math.round((geo.bodyLeft + 3) * s), Math.round(geo.rows[0].top * s))
  const differs = (c) => Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) > 40
  const edges = {}
  console.log(`paragraph text starts at x=${geo.textLeft.toFixed(1)} (dpr ${s})`)
  for (const row of geo.rows) {
    let first = null, last = null
    // Scan only the indent strip in front of the item's text, clear of the flag column.
    for (let x = Math.round((geo.bodyLeft + 22) * s); x < Math.round((row.textLeft - 1) * s); x++) {
      for (let y = Math.round(row.top * s); y < Math.round(row.bottom * s); y++) {
        if (differs(img.at(x, y))) { first ??= x; last = x; break }
      }
    }
    const f = first === null ? NaN : first / s, l = last === null ? NaN : last / s
    edges[row.name] = f - geo.textLeft
    console.log(`${row.name.padEnd(14)} marker ${f.toFixed(1)}..${l.toFixed(1)} (left edge ${(f - geo.textLeft).toFixed(1)}px past paragraph text, centre ${((f + l) / 2 - geo.textLeft).toFixed(1)}) | item text at ${(row.textLeft - geo.textLeft).toFixed(1)}px`)
  }
  for (const [task, bullet] of [['Task', 'Bullet'], ['Task nested', 'Bullet nested'], ['Task deep', 'Bullet deep']]) {
    check(Math.abs(edges[task] - edges[bullet]) <= 2, `"${task}" box starts within 2px of where "${bullet}" starts`, `${edges[task]} vs ${edges[bullet]}`)
  }
}
