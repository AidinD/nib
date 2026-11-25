/**
 * A card clicked straight after an edit opens - while the edit is still saving.
 *
 * Pressing a card takes focus from the body, whose blur saves at once. The save
 * rewrites the edited note's card, and when it landed between the button going
 * down and coming up, the cards under the pointer had moved: the press on one
 * card, the release on another, no click, and the note aimed at did not open.
 *
 * Both ways a save moves the cards, each with the click sent while the edit is
 * still pending:
 *
 * - a card ABOVE the one clicked grows, because its preview - which starts with
 *   the heading - changed (here from nothing, which makes it certain);
 * - in Recent, newest-edited first, the edited note jumps to the top.
 *
 * Checked each time: the press and the release land on the card aimed at, that
 * note opens from the one click, the list catches up afterwards, and the edit
 * that was pending is on disk.
 *
 * Every title and line here is invented.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_TEMPLATES } from '../../src/shared/templates.ts'
import { check } from './editor.mjs'

const SHOTS = process.env.PROBE_SHOTS

export function notebook(dir) {
  const day = (date) => new Date(`${date}T09:00:00`).getTime()
  const notes = [
    { id: 'note-a', title: 'Alfa', edited: day('2026-04-04'), html: '<h3>Alfa</h3><p>Första.</p>' },
    { id: 'note-b', title: 'Bravo', edited: day('2026-04-03'), html: '<h3>Bravo</h3><p>Andra.</p>' },
    { id: 'note-c', title: 'Charlie', edited: day('2026-04-02'), html: '<h3>Charlie</h3><p>Tredje.</p>' },
    { id: 'note-d', title: 'Delta', edited: day('2026-04-01'), html: '<h3>Delta</h3><p>Fjärde.</p>' }
  ]
  const meta = (note) => ({
    id: note.id, categoryId: 'cat-work', subId: null, title: note.title, preview: '',
    created: note.edited, edited: note.edited, pinned: false, tint: '', alerts: [], links: [], flag: '',
    kind: '', tags: [], archived: false, hasImage: false, hasDrawing: false
  })
  writeFileSync(join(dir, 'index.json'), JSON.stringify({
    version: 2,
    categories: [{ id: 'cat-work', name: 'Work', color: 'blue', scope: '', open: true, subs: [], notes: notes.map(meta) }],
    templates: DEFAULT_TEMPLATES
  }))
  for (const note of notes) {
    writeFileSync(join(dir, 'notes', `${note.id}.json`), JSON.stringify({
      id: note.id, categoryId: 'cat-work', subId: null, title: note.title,
      html: note.html, created: note.edited, edited: note.edited
    }))
  }
}

const titles = (page) => page.eval(`return [...document.querySelectorAll('.card .card-title')].map((t) => t.textContent.trim())`)

/** Tag a card by its title, for `page.click`. */
const tag = (page, title, cls) =>
  page.eval(`
    document.querySelectorAll('.${cls}').forEach((el) => el.classList.remove('${cls}'))
    ;[...document.querySelectorAll('.card')].find((c) => c.querySelector('.card-title')?.textContent.trim() === ${JSON.stringify(title)}).classList.add('${cls}')
    return true`)

const open = async (page, title, text) => {
  await tag(page, title, 'e2e-open')
  await page.click('.e2e-open')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes(${JSON.stringify(text)})`, `${title} opens`)
  await page.waitFor(`document.querySelector('.save-state')?.textContent === 'Saved'`, 'settled', 10)
}

/** Which card the press and the release each landed on. */
const watchPress = (page) =>
  page.eval(`
    window.__press = {}
    const card = (event) => event.target.closest?.('.card')?.querySelector('.card-title')?.textContent.trim() ?? null
    addEventListener('pointerdown', (event) => { window.__press.down = card(event) }, { capture: true, once: true })
    addEventListener('pointerup', (event) => { window.__press.up = card(event) }, { capture: true, once: true })
    return true`)

const round = async (page, { from, to, toText, edit, typed, label, moved }) => {
  await page.eval(edit)
  await page.type(typed)
  const pending = await page.eval(`return document.querySelector('.save-state')?.textContent`)
  check(pending === 'Saving…', `${label}: the edit is still pending when the click comes`, pending)
  await tag(page, to, 'e2e-target')
  await tag(page, from, 'e2e-edited')
  const before = await page.eval(`return { order: [...document.querySelectorAll('.card .card-title')].map((t) => t.textContent.trim()), h: Math.round(document.querySelector('.e2e-edited').getBoundingClientRect().height) }`)
  await watchPress(page)
  await page.click('.e2e-target')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes(${JSON.stringify(toText)})`, `${label}: ${to} opens from one click`, 5)
  const press = await page.eval(`return window.__press`)
  console.log(`    ${label}: press`, JSON.stringify(press))
  check(press.down === to && press.up === to, `${label}: the press and the release land on ${to}`, JSON.stringify(press))
  check(true, `${label}: and ${to} opens from that one click`)
  await page.waitFor(moved(before), `${label}: the list catches up`, 10)
  check(true, `${label}: afterwards the list shows the save`)
}

export default async (page) => {
  await page.waitFor(`document.querySelectorAll('.card').length === 4`, 'the cards')

  // --- A card above the one clicked grows.
  await open(page, 'Alfa', 'Första.')
  await round(page, {
    label: 'card above grows',
    from: 'Alfa',
    to: 'Charlie',
    toText: 'Tredje.',
    edit: `
      const body = document.querySelector('.doc-body'); body.focus()
      const r = document.createRange(); r.selectNodeContents(body.querySelector('h3'))
      getSelection().removeAllRanges(); getSelection().addRange(r); return true`,
    typed: 'En mycket längre rubrik än den som stod här förut',
    moved: (before) => `[...document.querySelectorAll('.card')].find((c) => c.querySelector('.card-title').textContent.trim() === 'Alfa').getBoundingClientRect().height > ${before.h}`
  })

  // --- Recent: the edited note jumps to the top.
  await page.eval(`[...document.querySelectorAll('.smart-rows > *')].find((row) => row.textContent.startsWith('Recent')).classList.add('e2e-recent'); return true`)
  await page.click('.e2e-recent')
  await page.waitFor(`document.querySelectorAll('.card').length === 4`, 'Recent')
  const recent = await titles(page)
  check(recent[recent.length - 1] === 'Delta', 'Recent is newest-edited first, Delta last', JSON.stringify(recent))
  await open(page, 'Delta', 'Fjärde.')
  await round(page, {
    label: 'edited note jumps up',
    from: 'Delta',
    to: 'Bravo',
    toText: 'Andra.',
    edit: `
      const body = document.querySelector('.doc-body'); body.focus()
      const r = document.createRange(); r.selectNodeContents(body.querySelector('p')); r.collapse(false)
      getSelection().removeAllRanges(); getSelection().addRange(r); return true`,
    typed: ' Tillägg',
    moved: () => `document.querySelector('.card .card-title')?.textContent.trim() === 'Delta'`
  })
  if (SHOTS) await page.shot(`${SHOTS}/click-while-saving.png`, { x: 0, y: 0, width: 1280, height: 420 }, 1)

  // --- The edits that were pending when the clicks came are on disk.
  await open(page, 'Alfa', 'Första.')
  const alfa = await page.eval(`return document.querySelector('.doc-body h3')?.textContent`)
  check(alfa === 'En mycket längre rubrik än den som stod här förut', 'the heading typed over before the click was saved', alfa)
  await open(page, 'Delta', 'Fjärde.')
  const delta = await page.eval(`return document.querySelector('.doc-body p')?.textContent`)
  check(delta === 'Fjärde. Tillägg', 'and so was the line typed onto', delta)
}
