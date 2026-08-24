/**
 * Tests for archiving.
 *
 * The archive is a filter, and a filter is exactly the kind of feature that
 * half-works: it is easy to hide archived notes from the list you were looking
 * at when you built it, and leave them counted in "Needs you", or in the strip,
 * or in a sidebar number. Those are the failures nobody notices for weeks, so
 * they are the ones worth a test.
 *
 * `selection.ts` imports only types from `@shared/types`, which Node's type
 * stripping erases - so these run against the real source, alias and all.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  allAlerts,
  archivedHits,
  liveNotes,
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
    alerts: [],
    flag: '',
    kind: '',
    archived: false,
    hasImage: false,
    hasDrawing: false,
    ...extra
  }
}

/** One category, one sub, with whatever notes the test needs. */
function index(notes) {
  return {
    version: 1,
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

const lists = ['all', 'recent', 'sticky', 'alerts', 'category', 'sub']

function list(data, kind) {
  const selection =
    kind === 'category'
      ? { kind: 'category', categoryId: 'cat' }
      : kind === 'sub'
        ? { kind: 'sub', categoryId: 'cat', subId: 'sub' }
        : { kind }
  return selectedNotes(data, selection, 'all', '').map((n) => n.id)
}

test('an archived note leaves every list', () => {
  // Given every quality that would put it in a list: pinned, flagged, in the
  // sub-category. Archived still wins.
  const data = index([
    note('live', { subId: 'sub', pinned: true, flag: 'open' }),
    note('filed', { subId: 'sub', pinned: true, flag: 'open', archived: true })
  ])
  for (const kind of lists) {
    assert.deepEqual(list(data, kind), ['live'], `${kind} still shows the archived note`)
  }
})

test('the archive list shows the archived notes and nothing else', () => {
  const data = index([note('live'), note('filed', { archived: true })])
  assert.deepEqual(list(data, 'archive'), ['filed'])
})

test('the archive list is newest first', () => {
  const data = index([
    note('old', { archived: true, edited: 10 }),
    note('new', { archived: true, edited: 20 })
  ])
  assert.deepEqual(list(data, 'archive'), ['new', 'old'])
})

test('an archived note stops counting', () => {
  const data = index([
    note('live', { pinned: true, flag: 'open' }),
    note('filed', {
      archived: true,
      pinned: true,
      flag: 'open',
      alerts: [{ id: 'a', text: 'x', done: false }]
    })
  ])
  const counts = smartCounts(data, 'all')
  assert.equal(counts.all, 1)
  assert.equal(counts.recent, 1)
  assert.equal(counts.sticky, 1, 'the archived note is still counted as sticky')
  assert.equal(counts.alerts, 1, 'the archived note still needs you')
  assert.equal(counts.archived, 1)
})

test('an archived note leaves the alert strip', () => {
  const data = index([
    note('live', { flag: 'open' }),
    note('filed', { flag: 'open', archived: true, alerts: [{ id: 'a', text: 'x', done: false }] })
  ])
  assert.deepEqual(
    allAlerts(data, 'all').map((entry) => entry.note.id),
    ['live']
  )
})

test('liveNotes answers for the category and for one sub-category', () => {
  const category = index([
    note('loose'),
    note('in-sub', { subId: 'sub' }),
    note('filed', { archived: true }),
    note('filed-in-sub', { subId: 'sub', archived: true })
  ]).categories[0]
  assert.deepEqual(
    liveNotes(category).map((n) => n.id),
    ['loose', 'in-sub']
  )
  assert.deepEqual(
    liveNotes(category, 'sub').map((n) => n.id),
    ['in-sub']
  )
})

test('the archive list has a name', () => {
  assert.equal(selectionTitle(index([]), { kind: 'archive' }), 'Archive')
})

/* ------------------------------------------------- searching the archive -- */

const ALL = { kind: 'all' }

function searchable() {
  return index([
    note('plumber', { title: 'Ring the plumber' }),
    note('plumber-old', { title: 'Plumber, last spring', archived: true }),
    note('dentist', { title: 'Dentist' }),
    note('dentist-old', { title: 'Dentist, 2019', archived: true, subId: 'sub' })
  ])
}

test('a search leaves the archive alone by default', () => {
  assert.deepEqual(
    selectedNotes(searchable(), ALL, 'all', 'plumber').map((n) => n.id),
    ['plumber']
  )
})

test('a search reaches the archive when asked to', () => {
  assert.deepEqual(
    selectedNotes(searchable(), ALL, 'all', 'plumber', true).map((n) => n.id).sort(),
    ['plumber', 'plumber-old']
  )
})

test('the widening applies to a category and a sub-category too', () => {
  const data = searchable()
  const category = { kind: 'category', categoryId: 'cat' }
  const sub = { kind: 'sub', categoryId: 'cat', subId: 'sub' }
  assert.deepEqual(selectedNotes(data, category, 'all', 'dentist').map((n) => n.id), ['dentist'])
  assert.deepEqual(
    selectedNotes(data, category, 'all', 'dentist', true).map((n) => n.id).sort(),
    ['dentist', 'dentist-old']
  )
  // The sub-category still holds the list to its own notes, archived or not.
  assert.deepEqual(selectedNotes(data, sub, 'all', 'dentist').map((n) => n.id), [])
  assert.deepEqual(selectedNotes(data, sub, 'all', 'dentist', true).map((n) => n.id), ['dentist-old'])
})

test('the flag does nothing without a search', () => {
  // This is the whole guard: honoured with an empty needle, it would merge the
  // archive into every list and there would be no archive left.
  assert.deepEqual(
    selectedNotes(searchable(), ALL, 'all', '', true).map((n) => n.id),
    ['plumber', 'dentist']
  )
})

test('the toggle is offered only when it would change the answer', () => {
  const data = searchable()
  assert.equal(archivedHits(data, ALL, 'all', 'plumber'), 1)
  // "ring" alone would have matched "last spring" - a reminder that this is a
  // plain substring search, not a word search.
  assert.equal(archivedHits(data, ALL, 'all', 'ring the'), 0, 'nothing archived matches')
  assert.equal(archivedHits(data, ALL, 'all', ''), 0, 'no search, no offer')
  assert.equal(
    archivedHits(data, { kind: 'archive' }, 'all', 'plumber'),
    0,
    'the archive list is already the archive'
  )
})

test('the count does not change when the archive is already showing', () => {
  // The line has to keep saying the same number once it is switched on, or it
  // reads as the matches having gone somewhere.
  const data = searchable()
  const shown = selectedNotes(data, ALL, 'all', 'plumber', true).filter((n) => n.archived).length
  assert.equal(shown, archivedHits(data, ALL, 'all', 'plumber'))
})
