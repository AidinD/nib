/**
 * Columns: getting out of a row, making one from a selection, and lists inside
 * one - the three reported together on 2026-11-27.
 *
 *   1. Out of a row. The Columns button is a toggle and turns a row back into
 *      ordinary lines, in reading order; the row's own controls show up when
 *      the caret arrives by keyboard, not only on a click, and say "Back to
 *      text" rather than a red "Remove". Backspace at the start of the first
 *      column does the same; at the start of a later column it moves back a
 *      column, and Delete at the end of one moves forward.
 *   2. From a selection. Lines selected and Columns pressed: those lines are the
 *      first column, the second is empty, and the caret is in it.
 *   3. Lists in a column. Turning Bullets off in a column used to leave the text
 *      loose in the cell, after which "- " stayed a dash and Enter made a new
 *      COLUMN. A column now always holds lines, so bullets work again, in
 *      either column; and the Bullets button no longer leaves `<p><ul>` behind.
 */

import { body, check, keys, openNote, setBody } from './editor.mjs'

const button = (page, name) =>
  page.eval(`[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === ${JSON.stringify(name)}).click(); return true`)
const row = (left, right) => `<p>Start</p><div data-cols="2"><div data-col="">${left}</div><div data-col="">${right}</div></div><p>End</p>`
const cells = (page) => page.eval(`return [...document.querySelectorAll('.doc-body [data-col]')].map(c => c.innerHTML)`)

export default async (page) => {
  await openNote(page)

  // --- 1. Out of a row.
  const filled = row('<p>a</p><ul><li>b</li></ul>', '<p>c</p><p><br></p>')
  await setBody(page, filled, ['c', 1])
  await page.waitFor(`document.querySelector('.columns-toolbar') !== null`, 'the row controls follow the caret')
  check(await page.eval(`return document.querySelector('.columns-toolbar').textContent.includes('Back to text') && document.querySelector('.columns-toolbar .danger') === null`), 'they offer "Back to text", not a red Remove')
  check(await page.eval(`return [...document.querySelectorAll('.toolbar button')].find(b => b.textContent.trim() === 'Columns').classList.contains('is-active')`), 'the Columns button is lit inside a row')
  await button(page, 'Columns')
  check((await body(page)) === '<p>Start</p><p>a</p><ul><li>b</li></ul><p>c</p><p>End</p>', 'Columns again turns the row back into lines, in order, nothing lost', await body(page))
  await page.waitFor(`document.querySelector('.columns-toolbar') === null`, 'and the row controls go with it')

  await setBody(page, filled, ['c', 1])
  await page.waitFor(`document.querySelector('.columns-toolbar') !== null`, 'the row controls')
  await page.eval(`[...document.querySelectorAll('.columns-toolbar button')].find(b => b.textContent.trim() === 'Back to text').click(); return true`)
  check((await body(page)) === '<p>Start</p><p>a</p><ul><li>b</li></ul><p>c</p><p>End</p>', '"Back to text" does the same', await body(page))

  await setBody(page, filled, ['a', 0])
  await keys.backspace(page)
  await page.type('X')
  check((await body(page)) === '<p>Start</p><p>Xa</p><ul><li>b</li></ul><p>c</p><p>End</p>', 'Backspace at the start of the first column takes the row apart, caret where it was', await body(page))

  await setBody(page, filled, ['c', 0])
  await keys.backspace(page)
  await page.type('X')
  check((await cells(page))[0] === '<p>a</p><ul><li>bX</li></ul>', 'Backspace at the start of the second column goes to the end of the first', JSON.stringify(await cells(page)))

  await setBody(page, filled, ['b', 1])
  await page.key(46, 'Delete', 'Delete')
  await page.type('Y')
  check((await cells(page))[1] === '<p>Yc</p><p><br></p>', 'Delete at the end of the first column goes to the start of the second', JSON.stringify(await cells(page)))

  // --- 2. From a selection.
  await page.eval(`
    const root = document.querySelector('.doc-body'); root.innerHTML = '<p>Start</p><p>one</p><ul><li>two</li></ul><p>three</p>'; root.focus()
    const range = document.createRange()
    range.setStart(root.children[1].firstChild, 1)
    range.setEnd(root.children[2].querySelector('li').firstChild, 2)
    getSelection().removeAllRanges(); getSelection().addRange(range)
    return true`)
  await button(page, 'Columns')
  await page.type('Z')
  check(
    (await body(page)) === '<p>Start</p><div data-cols="2"><div data-col=""><p>one</p><ul><li>two</li></ul></div><div data-col=""><p>Z</p></div></div><p>three</p>',
    'the selected lines are the first column, the second is empty and has the caret',
    await body(page)
  )
  // A selection ending at the start of a line - a triple-click - leaves that line out.
  await page.eval(`
    const root = document.querySelector('.doc-body'); root.innerHTML = '<p>Start</p><p>one</p><p>two</p>'; root.focus()
    const range = document.createRange()
    range.setStart(root.children[1].firstChild, 0)
    range.setEnd(root.children[2].firstChild, 0)
    getSelection().removeAllRanges(); getSelection().addRange(range)
    return true`)
  await button(page, 'Columns')
  check(
    (await body(page)) === '<p>Start</p><div data-cols="2"><div data-col=""><p>one</p></div><div data-col=""><p><br></p></div></div><p>two</p>',
    'a selection ending at the start of a line does not take that line',
    await body(page)
  )

  // --- 3. Lists in a column, both sides.
  for (const side of [0, 1]) {
    const name = side === 0 ? 'left' : 'right'
    const html = side === 0 ? row('<ul><li>A</li></ul>', '<p>R</p>') : row('<p>L</p>', '<ul><li>A</li></ul>')
    await setBody(page, html, ['A', 1])
    await button(page, 'Bullets')
    check((await cells(page))[side] === '<p>A</p>', `${name}: Bullets off leaves a line, not loose text`, JSON.stringify(await cells(page)))
    await page.enter()
    await page.type('- x')
    await page.enter()
    await page.type('y')
    check((await cells(page))[side] === '<p>A</p><ul><li>x</li><li>y</li></ul>', `${name}: and "- " makes bullets after it, Enter a second item`, JSON.stringify(await cells(page)))
    check(await page.eval(`return document.querySelectorAll('.doc-body [data-col]').length`) === 2, `${name}: still two columns`)

    await setBody(page, side === 0 ? row('<p>A</p>', '<p>R</p>') : row('<p>L</p>', '<p>A</p>'), ['A', 1])
    await button(page, 'Bullets')
    check((await cells(page))[side] === '<ul><li>A</li></ul>', `${name}: the Bullets button makes a list, not a list inside a paragraph`, JSON.stringify(await cells(page)))
  }

  // Text loose in a cell, from a note written that way, is a line once loaded.
  await page.eval(`
    const doc = await window.nib.readNote('note-e2e')
    await window.nib.writeNote({ ...doc, html: ${JSON.stringify(row('<p>L</p>', 'loose<br>second'))} })
    return true`)
  await page.eval(`location.reload(); return true`)
  await page.waitFor(`document.querySelector('.card') !== null`)
  await page.click('.card')
  await page.waitFor(`document.querySelector('.doc-body [data-cols]') !== null`, 'the note with loose text, reloaded')
  const loose = await page.eval(`return [...document.querySelectorAll('.doc-body [data-col]')].flatMap(c => [...c.childNodes]).filter(n => n.nodeType === 3 || n.nodeName === 'BR' || n.nodeName === 'SPAN').length`)
  check(loose === 0 && (await cells(page))[1].startsWith('<p>loose'), 'loose text in a column is in a line once loaded', JSON.stringify(await cells(page)))
}
