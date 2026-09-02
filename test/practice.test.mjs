/**
 * Tests for the two kinds of flag.
 *
 * A commitment is finished by doing it. Something you are practising is not
 * finished at all - "listen longer than it is comfortable" has no done state, and
 * one list holding both makes the second kind look permanently overdue and the
 * count meaningless: it said nine when three were owed.
 *
 * The split is by the note's Principle tag, decided when it was put as a
 * question. That is the choice these tests pin, including its cost - a note
 * carrying both kinds of line cannot have them separated, so a mixed note lands
 * wholly on one side.
 *
 * `selection.ts` imports only types from `@shared/types`, which Node's type
 * stripping erases, so these run against the real source.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  allAlerts,
  isPractice,
  PRACTICE_TAG,
  selectedNotes,
  selectionTitle,
  smartCounts
} from '../src/renderer/src/lib/selection.ts'

function note(id, extra = {}) {
  return {
    id,
    categoryId: 'cat',
    subId: null,
    title: id,
    preview: '',
    created: 1,
    edited: 1,
    pinned: false,
    tint: '',
    tags: [],
    alerts: [],
    flag: '',
    kind: '',
    archived: false,
    hasImage: false,
    hasDrawing: false,
    ...extra
  }
}

function index(notes) {
  return {
    version: 1,
    tags: [{ id: PRACTICE_TAG, name: 'Principle' }],
    categories: [
      {
        id: 'cat',
        name: 'Cat',
        color: '#fff',
        scope: '',
        open: true,
        subs: [{ id: 'sub', name: 'Sub' }],
        notes
      }
    ]
  }
}

const open = (id) => ({ id, text: id, done: false })
const done = (id) => ({ id, text: id, done: true })

const list = (data, kind) => selectedNotes(data, { kind }, 'all', '').map((n) => n.id)

/** A 1-1 with two things owed, and a principle with two things to work on. */
const both = () =>
  index([
    note('owed', { alerts: [open('a1'), open('a2')], tags: ['tag-one-to-one'] }),
    note('practising', { alerts: [open('p1'), open('p2')], tags: [PRACTICE_TAG] })
  ])

test('the Principle tag is what decides', () => {
  assert.equal(isPractice({ tags: [PRACTICE_TAG] }), true)
  assert.equal(isPractice({ tags: ['tag-one-to-one'] }), false)
  // A note read from an index written before tags existed has none at all.
  assert.equal(isPractice({}), false)
})

test('the counts no longer add the two together', () => {
  const counts = smartCounts(both(), 'all')
  assert.equal(counts.alerts, 2)
  assert.equal(counts.practice, 2)
})

test('a count answers how many things, not how many notes', () => {
  const counts = smartCounts(
    index([note('p', { alerts: [open('a'), open('b'), open('c')], tags: [PRACTICE_TAG] })]),
    'all'
  )
  assert.equal(counts.practice, 3)
  assert.equal(counts.alerts, 0)
})

test('a note that is itself the flag counts on the right side', () => {
  const counts = smartCounts(
    index([
      note('whole', { flag: 'open', tags: [PRACTICE_TAG] }),
      note('owed', { flag: 'open' })
    ]),
    'all'
  )
  assert.equal(counts.practice, 1)
  assert.equal(counts.alerts, 1)
})

test('a dealt-with flag counts on neither', () => {
  const counts = smartCounts(
    index([
      note('owed', { alerts: [done('a')] }),
      note('practising', { alerts: [done('p')], tags: [PRACTICE_TAG] })
    ]),
    'all'
  )
  assert.equal(counts.alerts, 0)
  assert.equal(counts.practice, 0)
})

test('each list shows only its own kind', () => {
  const data = both()
  assert.deepEqual(list(data, 'alerts'), ['owed'])
  assert.deepEqual(list(data, 'practice'), ['practising'])
})

test('a note whose flags are all done stays in its list', () => {
  // The rule the review list already had: a card does not vanish from under the
  // pointer that just ticked it.
  const data = index([note('practising', { alerts: [done('p')], tags: [PRACTICE_TAG] })])
  assert.deepEqual(list(data, 'practice'), ['practising'])
  assert.deepEqual(list(data, 'alerts'), [])
})

test('a note with no flags is in neither list', () => {
  const data = index([note('plain', { tags: [PRACTICE_TAG] }), note('bare')])
  assert.deepEqual(list(data, 'practice'), [])
  assert.deepEqual(list(data, 'alerts'), [])
})

test('the strip leaves what you are practising alone', () => {
  // It is the ambient "you owe these" line under the header. A principle would
  // sit in it permanently, which is how you learn to stop reading it.
  const entries = allAlerts(both(), 'all')
  assert.deepEqual(entries.map((e) => e.note.id), ['owed', 'owed'])
})

test('the rows are named for what they are', () => {
  assert.equal(selectionTitle(both(), { kind: 'alerts' }), 'Needs you')
  assert.equal(selectionTitle(both(), { kind: 'practice' }), 'Practising')
})

test('a mixed note lands wholly on one side, which is the known cost', () => {
  /*
   * The accepted trade-off, pinned so nobody later reads it as a bug. A 1-1
   * summary can hold "send the underlying material" - owed - and "listen longer"
   * - practised - and splitting by the note's tag cannot tell them apart. The
   * note is tagged 1-1, so both count as owed.
   */
  const data = index([
    note('oneToOne', { alerts: [open('send'), open('listen')], tags: ['tag-one-to-one'] })
  ])
  assert.equal(smartCounts(data, 'all').alerts, 2)
  assert.equal(smartCounts(data, 'all').practice, 0)
})
