/**
 * "Till nästa gång", end to end: written in one 1-1, in front of you before the
 * next one.
 *
 * A person's folder with two earlier 1-1s and a newer note that is not a 1-1.
 * The newest 1-1 has the section twice - his own list under the template's
 * heading, and the summary's - with one item ticked. The catalog is the 1-1
 * template as notebooks were seeded before the section existed, so the upgrade
 * is exercised too.
 *
 * Checked: the folder shows the newest list at once, without opening a note -
 * both halves, without the ticked item or the template's prompt, and not the
 * older note's; a new 1-1 starts with that list as open items under
 * "Uppföljning" and ends with its own empty section; once something is written
 * into the new one, the folder shows that instead; the old notes still open; and
 * the section is marked in amber wherever it is - an old note's, the summary's -
 * and loses the mark when its heading is renamed.
 *
 * Every name and line here is invented. PROBE_SHOTS=<dir> also writes
 * screenshots of the folder and the new note.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_TEMPLATES } from '../../src/shared/templates.ts'
import { NEXT_TIME, NEXT_TIME_PROMPT } from '../../src/shared/next-time.ts'
import { summaryHtml } from '../../src/renderer/src/lib/notes.ts'
import { check } from './editor.mjs'

const SHOTS = process.env.PROBE_SHOTS
const SECTION = `<h3>${NEXT_TIME}</h3><p><em>${NEXT_TIME_PROMPT}</em></p>`

export function notebook(dir) {
  const oneToOne = DEFAULT_TEMPLATES.find((template) => template.id === 'tpl-one-to-one')
  const legacy = { ...oneToOne, body: oneToOne.body.slice(0, -SECTION.length) }
  const day = (date) => new Date(`${date}T09:00:00`).getTime()
  const summary =
    '<div data-summary="1">' +
    summaryHtml(
      { model: 'm', costUsd: null },
      {
        summary: 'Ett samtal om veckan.',
        decisions: [],
        actions: [{ text: 'Skicka underlaget', implied: false }],
        questions: [],
        people: [],
        nextTime: ['Fråga hur flytten gick']
      }
    ) +
    '</div>'
  const notes = [
    {
      id: 'note-old', title: '2026-03-03 1-1', created: day('2026-03-03'), tags: ['tag-one-to-one'],
      html: `${legacy.body}<h3>${NEXT_TIME}</h3><ul><li>Gammal punkt</li></ul>`
    },
    {
      id: 'note-last', title: '2026-03-17 1-1', created: day('2026-03-17'), tags: ['tag-one-to-one'],
      html:
        summary +
        legacy.body +
        `${SECTION}<ul><li>Skicka förslaget om onboarding</li><li data-task="done">Redan klart</li></ul>`
    },
    // Newer, and not a 1-1: the folder reads past it, the next 1-1 never sees it.
    { id: 'note-other', title: '2026-03-20 Anteckning', created: day('2026-03-20'), tags: [], html: '<p>Något annat.</p>' }
  ]
  const meta = (note) => ({
    id: note.id, categoryId: 'cat-people', subId: 'sub-kim', title: note.title, preview: '',
    created: note.created, edited: note.created, pinned: false, tint: '', alerts: [], links: [], flag: '',
    kind: '', tags: note.tags, archived: false, hasImage: false, hasDrawing: false
  })
  writeFileSync(join(dir, 'index.json'), JSON.stringify({
    version: 2,
    categories: [{
      id: 'cat-people', name: 'People', color: 'blue', scope: '', open: true,
      subs: [{ id: 'sub-kim', name: 'Kim' }], notes: notes.map(meta)
    }],
    templates: [legacy, DEFAULT_TEMPLATES.find((template) => template.id === 'tpl-story')]
  }))
  for (const note of notes) {
    writeFileSync(join(dir, 'notes', `${note.id}.json`), JSON.stringify({
      id: note.id, categoryId: 'cat-people', subId: 'sub-kim', title: note.title,
      html: note.html, created: note.created, edited: note.created
    }))
  }
}

const strip = (page) =>
  page.eval(`
    const el = document.querySelector('.next-time')
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return { from: el.querySelector('.next-time-from').textContent, lines: [...el.querySelectorAll('li')].map((li) => li.textContent),
      top: Math.round(r.top), h: Math.round(r.height), aboveCards: r.bottom <= document.querySelector('.card').getBoundingClientRect().top }`)

export default async (page) => {
  await page.waitFor(`[...document.querySelectorAll('.sub-row')].some((row) => row.textContent.includes('Kim'))`, 'the folder')
  await page.eval(`[...document.querySelectorAll('.sub-row')].find((row) => row.textContent.includes('Kim')).classList.add('e2e-kim'); return true`)
  await page.click('.e2e-kim')
  await page.waitFor(`document.querySelector('.next-time') !== null`, 'the next-time strip')

  // --- Opening the folder shows the newest list, nothing opened.
  const shown = await strip(page)
  console.log('    folder:', JSON.stringify(shown))
  check(shown.from === '2026-03-17 1-1', 'the folder shows the newest 1-1, read past a newer note that is not one', shown.from)
  check(
    JSON.stringify(shown.lines) === JSON.stringify(['Fråga hur flytten gick', 'Skicka förslaget om onboarding']),
    'both halves - the summary and his own list - without the ticked item or the prompt',
    JSON.stringify(shown.lines)
  )
  check(shown.aboveCards && shown.h > 30, 'above the cards, as a box of its own')
  const opened = await page.eval(`return document.querySelector('.doc-body') !== null && document.querySelector('.card.is-active') !== null`)
  check(!opened, 'no note had to be opened for it')
  if (SHOTS) await page.shot(`${SHOTS}/next-time-folder.png`, { x: 0, y: 0, width: 760, height: 420 }, 1)

  // --- A new 1-1 starts with it.
  await page.click('.add-story')
  await page.waitFor(`document.querySelector('.template-choice') !== null`, 'template menu')
  await page.eval(`[...document.querySelectorAll('.template-choice')].find((b) => b.textContent.startsWith('1-1')).classList.add('e2e-one'); return true`)
  await page.click('.e2e-one')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes('Från förra gången')`, 'the new note with last time carried in')
  const fresh = await page.eval(`
    const body = document.querySelector('.doc-body')
    const heads = [...body.querySelectorAll('h3')].map((h) => h.textContent)
    const carried = [...body.querySelectorAll('li[data-task]')].map((li) => li.dataset.task + ':' + li.textContent)
    const follow = [...body.querySelectorAll('h3')].find((h) => h.textContent === 'Uppföljning')
    const intro = [...body.querySelectorAll('p')].find((p) => p.textContent.startsWith('Från förra gången'))
    return { heads, carried, intro: intro?.textContent, underFollowUp: follow.compareDocumentPosition(intro) === Node.DOCUMENT_POSITION_FOLLOWING && heads.indexOf('Uppföljning') === 0 }`)
  console.log('    new note:', JSON.stringify(fresh))
  check(fresh.intro === 'Från förra gången (2026-03-17 1-1):' && fresh.underFollowUp, 'carried in under Uppföljning, naming the note it came from')
  check(
    JSON.stringify(fresh.carried) === JSON.stringify(['open:Fråga hur flytten gick', 'open:Skicka förslaget om onboarding']),
    'as open checklist items, to tick off as they come up',
    JSON.stringify(fresh.carried)
  )
  check(fresh.heads[fresh.heads.length - 1] === NEXT_TIME, 'and the new note ends with its own section - the upgraded template')
  if (SHOTS) await page.shot(`${SHOTS}/next-time-new-note.png`, { x: 0, y: 0, width: 1280, height: 560 }, 1)

  // --- Written into the new one, the folder shows that instead.
  await page.eval(`
    const body = document.querySelector('.doc-body'); body.focus()
    const prompt = [...body.querySelectorAll('p')].find((p) => p.textContent === ${JSON.stringify(NEXT_TIME_PROMPT)})
    const r = document.createRange(); r.selectNodeContents(prompt); r.collapse(false)
    getSelection().removeAllRanges(); getSelection().addRange(r); return true`)
  await page.enter()
  await page.type('Boka genomgången i april')
  await page.waitFor(`document.querySelector('.next-time-from')?.textContent.endsWith('1-1') && document.querySelector('.next-time-from').textContent !== '2026-03-17 1-1'`, 'the strip follows the new note', 20)
  const after = await strip(page)
  console.log('    after writing:', JSON.stringify(after))
  check(after.lines.includes('Boka genomgången i april') && !after.lines.includes(NEXT_TIME_PROMPT), 'the folder now shows what was written in the newest 1-1', JSON.stringify(after.lines))

  // --- Existing notes still open as they were.
  await page.click('.next-time-head')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes('Boka genomgången')`, 'the strip opens its note')
  await page.eval(`[...document.querySelectorAll('.card')].find((c) => c.textContent.includes('2026-03-03 1-1')).classList.add('e2e-old'); return true`)
  await page.click('.e2e-old')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes('Gammal punkt')`, 'an old note opens')
  const old = await page.eval(`return [...document.querySelectorAll('.doc-body h3')].map((h) => h.textContent)`)
  check(old.includes('Uppföljning') && old.includes(NEXT_TIME), 'an old 1-1 renders with its own sections', JSON.stringify(old))

  // --- And the section is marked in it, the way an answer is - a note written
  // before the marking existed, painted the moment it is opened.
  const paint = () =>
    page.eval(`
      const body = document.querySelector('.doc-body')
      const amber = getComputedStyle(document.documentElement).getPropertyValue('--amber').trim()
      const head = [...body.querySelectorAll('h2, h3')].find((h) => h.textContent === ${JSON.stringify(NEXT_TIME)})
      const look = (el) => el === null || el === undefined ? null : { mark: el.dataset.nextTime ?? null, border: getComputedStyle(el).borderLeftColor, bg: getComputedStyle(el).backgroundColor }
      const follow = [...body.querySelectorAll('h3')].find((h) => h.textContent === 'Uppföljning')
      return { amber, head: look(head), list: look(head?.nextElementSibling), followUp: look(follow), marked: body.querySelectorAll('[data-next-time]').length }`)
  const painted = await paint()
  console.log('    marked:', JSON.stringify(painted))
  const isAmber = (look) => look !== null && look.border === 'rgb(255, 176, 84)' && /^color\(srgb 1 0\.69\d* 0\.329\d* \/ 0\.13\)$/.test(look.bg)
  check(painted.head?.mark === 'head' && isAmber(painted.head), 'the heading is marked in amber - rule and wash', JSON.stringify(painted.head))
  check(painted.list?.mark === 'line' && isAmber(painted.list), 'and the list under it, as part of the same band', JSON.stringify(painted.list))
  check(painted.followUp?.mark === null && painted.followUp.bg === 'rgba(0, 0, 0, 0)', 'and nothing outside the section', JSON.stringify(painted.followUp))

  // --- Renamed away from the section, the heading loses the mark as it is typed.
  await page.eval(`
    const body = document.querySelector('.doc-body'); body.focus()
    const head = [...body.querySelectorAll('h3')].find((h) => h.textContent === ${JSON.stringify(NEXT_TIME)})
    const r = document.createRange(); r.selectNodeContents(head)
    getSelection().removeAllRanges(); getSelection().addRange(r); return true`)
  await page.type('Avslut')
  await page.waitFor(`document.querySelector('.doc-body [data-next-time]') === null`, 'the mark goes with the heading', 10)
  check(true, 'a heading renamed away from it is no longer marked')

  // --- The newest 1-1, both halves: the summary's and his own. By title, not by
  // the card's text: the new note's preview names this one too.
  // Straight away, with the rename still saving: the click opens what it was
  // aimed at - see test/e2e/click-while-saving.steps.mjs.
  await page.eval(`[...document.querySelectorAll('.card')].find((c) => c.querySelector('.card-title')?.textContent.trim() === '2026-03-17 1-1').classList.add('e2e-last'); return true`)
  await page.click('.e2e-last')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes('Redan klart')`, 'the newest 1-1 opens')
  const both = await page.eval(`
    const heads = [...document.querySelectorAll('.doc-body [data-next-time="head"]')]
    return heads.map((h) => h.tagName + (h.closest('[data-summary]') ? ' in summary' : ''))`)
  check(JSON.stringify(both) === JSON.stringify(['H2 in summary', 'H3']), "the summary's section is marked as well as his own", JSON.stringify(both))
  if (SHOTS) {
    const clip = await page.eval(`
      const head = document.querySelectorAll('.doc-body [data-next-time="head"]')[1]
      head.scrollIntoView({ block: 'center' })
      const doc = document.querySelector('.doc-body').getBoundingClientRect()
      const r = head.getBoundingClientRect()
      return { x: Math.round(doc.left) - 40, y: Math.max(0, Math.round(r.top) - 260), width: Math.round(doc.width) + 60, height: 420 }`)
    await page.shot(`${SHOTS}/next-time-marked.png`, clip, 1)
    const top = await page.eval(`
      const head = document.querySelectorAll('.doc-body [data-next-time="head"]')[0]
      head.scrollIntoView({ block: 'center' })
      const doc = document.querySelector('.doc-body').getBoundingClientRect()
      const r = head.getBoundingClientRect()
      return { x: Math.round(doc.left) - 40, y: Math.max(0, Math.round(r.top) - 200), width: Math.round(doc.width) + 60, height: 320 }`)
    await page.shot(`${SHOTS}/next-time-marked-summary.png`, top, 1)
  }
}
