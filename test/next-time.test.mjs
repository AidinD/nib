/**
 * "Till nästa gång": the section a 1-1 ends with, and where it is read back.
 *
 * Covered here without a document: recognising the heading, which notes are
 * read for it and in which order, where last time's list lands in a new note,
 * the template upgrade that brings the section to a notebook seeded before it,
 * and the summary field. Reading the section out of a note's HTML needs a
 * document and is covered in test/e2e/next-time.steps.mjs.
 *
 * Every name and line here is invented.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  NEXT_TIME,
  NEXT_TIME_PROMPT,
  hasNextTime,
  isNextTimeHeading,
  nextTimeCandidates,
  noteDate,
  withCarriedOver
} from '../src/shared/next-time.ts'
import { DEFAULT_TEMPLATES, normalizeTemplates } from '../src/shared/templates.ts'
import { schemaFor } from '../src/main/summary.ts'
import { summaryHtml } from '../src/renderer/src/lib/notes.ts'

const ONE_TO_ONE = DEFAULT_TEMPLATES.find((template) => template.id === 'tpl-one-to-one')
const SECTION = `<h3>${NEXT_TIME}</h3><p><em>${NEXT_TIME_PROMPT}</em></p>`

test('the heading is recognised in its forms, and nothing else is', () => {
  for (const text of ['Till nästa gång', 'till nästa gång:', '  Nästa gång ', 'Next time']) {
    assert.equal(isNextTimeHeading(text), true, text)
  }
  for (const text of ['Uppföljning', 'Till nästa gång vi ses i mars', 'Sedan förra gången']) {
    assert.equal(isNextTimeHeading(text), false, text)
  }
})

test('the 1-1 template ends with the section', () => {
  assert.ok(ONE_TO_ONE.body.endsWith(SECTION))
  assert.equal(hasNextTime(ONE_TO_ONE.body), true)
  assert.equal(hasNextTime(DEFAULT_TEMPLATES.find((template) => template.id === 'tpl-story').body), false)
})

test('a notebook seeded before the section gets it, and a rewritten 1-1 is left alone', () => {
  const legacy = ONE_TO_ONE.body.slice(0, -SECTION.length)
  const [upgraded] = normalizeTemplates([{ ...ONE_TO_ONE, body: legacy }])
  assert.equal(upgraded.body, ONE_TO_ONE.body)
  const mine = '<h3>Mina frågor</h3><p>Hur går det?</p>'
  const [kept] = normalizeTemplates([{ ...ONE_TO_ONE, body: mine }])
  assert.equal(kept.body, mine)
})

const note = (id, title, extra = {}) => ({
  id,
  categoryId: 'cat-people',
  subId: 'sub-kim',
  title,
  created: 0,
  edited: 0,
  tags: ['tag-one-to-one'],
  archived: false,
  ...extra
})

test('the date in the title decides which note is newest, not when it was made', () => {
  assert.ok(noteDate({ title: '2026-03-10 1-1', created: 0 }) > noteDate({ title: '2026-03-03 1-1', created: 9e12 }))
  assert.equal(noteDate({ title: 'Utan datum', created: 42 }), 42)
})

test('candidates: one folder, live notes, the template tags, newest first', () => {
  const notes = [
    note('a', '2026-03-03 1-1', { created: 3 }),
    note('b', '2026-03-17 1-1', { created: 1 }),
    note('c', '2026-03-10 1-1', { created: 2 }),
    note('archived', '2026-03-24 1-1', { archived: true }),
    note('elsewhere', '2026-03-24 1-1', { subId: 'sub-alex' }),
    note('untagged', '2026-03-24 Anteckning', { tags: [] })
  ]
  const folder = { categoryId: 'cat-people', subId: 'sub-kim' }
  assert.deepEqual(nextTimeCandidates(notes, folder, ['tag-one-to-one']).map((n) => n.id), ['b', 'c', 'a'])
  assert.deepEqual(nextTimeCandidates(notes, folder).map((n) => n.id), ['untagged', 'b', 'c', 'a'])
  assert.deepEqual(nextTimeCandidates(notes, folder, [], 2).map((n) => n.id), ['untagged', 'b'])
})

test("last time's list lands under the first heading, past its prompt, as open items", () => {
  const body = withCarriedOver(ONE_TO_ONE.body, ['Skicka förslaget', 'Fråga om <budget>'], '2026-03-17 1-1')
  const head = '<h3>Uppföljning</h3><p><em>'
  const at = body.indexOf('Från förra gången')
  assert.ok(at > body.indexOf(head) && at < body.indexOf('<h3>Öppen space</h3>'))
  assert.ok(body.indexOf('</em></p>', body.indexOf(head)) < at, 'after the prompt, not inside or before it')
  assert.ok(body.includes('<li data-task="open">Skicka förslaget</li><li data-task="open">Fråga om &lt;budget&gt;</li>'))
  assert.ok(body.includes('(2026-03-17 1-1)'))
  assert.equal(withCarriedOver(ONE_TO_ONE.body, [], 'x'), ONE_TO_ONE.body)
  assert.ok(withCarriedOver('<p>Ingen rubrik</p>', ['Rad'], 'x').startsWith('<p><strong>Från förra gången'))
})

test('the summary has the field for a 1-1 and a manager conversation only', () => {
  assert.ok('nextTime' in schemaFor('one-to-one').properties)
  assert.ok('nextTime' in schemaFor('manager').properties)
  for (const kind of ['check-in', 'meeting', 'status']) {
    assert.equal('nextTime' in schemaFor(kind).properties, false, kind)
  }
})

test('the summary writes it under the same heading, and nothing when it is empty', () => {
  const value = { summary: 'S.', decisions: [], actions: [], questions: [], people: [] }
  const html = summaryHtml({ model: 'm', costUsd: null }, { ...value, nextTime: ['Följ upp rekryteringen'] })
  assert.ok(html.includes(`<h2>${NEXT_TIME}</h2><ul><li>Följ upp rekryteringen</li></ul>`))
  assert.equal(summaryHtml({ model: 'm', costUsd: null }, { ...value, nextTime: [] }).includes(NEXT_TIME), false)
})
