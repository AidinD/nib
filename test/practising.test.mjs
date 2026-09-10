/**
 * The violet lane's source: the flag, read every time.
 *
 * The rule that matters is not which notes appear but WHERE the answer comes
 * from. A principle stops being one you are working on the moment the flag is
 * cleared in the gutter, and the app changes that without telling anybody - so
 * anything stored would start disagreeing with the document within a day, and a
 * reminder caught lying once is a reminder you stop believing.
 *
 * The names are invented. The real notebook's principles are about colleagues
 * and this repository is public.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { practising, PRACTICE_TAG } from '../src/renderer/src/lib/selection.ts'

function note(id, title, flag, tags, edited = 0, extra = {}) {
  return {
    id,
    categoryId: 'cat',
    subId: null,
    title,
    preview: '',
    created: 0,
    edited,
    pinned: false,
    tint: '',
    alerts: [],
    links: [],
    flag,
    tags,
    archived: false,
    hasImage: false,
    hasDrawing: false,
    ...extra
  }
}

function notebook(notes) {
  return {
    version: 2,
    tags: [{ id: PRACTICE_TAG, name: 'Principle', color: '', description: '' }],
    templates: [],
    categories: [
      { id: 'cat', name: 'Growth', color: '', scope: 'W', open: true, subs: [], notes }
    ]
  }
}

test('a flagged principle is in the lane', () => {
  const rows = practising(notebook([note('a', 'Listen longer than is comfortable', 'open', [PRACTICE_TAG])]), 'all')
  assert.deepEqual(rows.map((row) => row.id), ['a'])
})

test('the same principle without the flag is not', () => {
  // The tag says what the note IS. The flag says whether it is live, and 57 of
  // the real notebook's 60 principles are not.
  const rows = practising(
    notebook([
      note('a', 'Listen longer', '', [PRACTICE_TAG]),
      note('b', 'Ask before advising', 'done', [PRACTICE_TAG])
    ]),
    'all'
  )
  assert.deepEqual(rows, [])
})

test('a flagged note that is not a principle stays in the other lane', () => {
  const rows = practising(notebook([note('a', 'Send the deck', 'open', [])]), 'all')
  assert.deepEqual(rows, [], 'that is what Needs you is for')
})

test('a flagged LINE inside a principle does not put the note in the lane', () => {
  /*
   * A principle is a whole note - there is nothing to quote and nothing to tick
   * off halfway. An action point written inside one is an action point, and the
   * note itself is not thereby being practised.
   */
  const rows = practising(
    notebook([
      note('a', 'Listen longer', '', [PRACTICE_TAG], 0, {
        alerts: [{ id: 'x', text: 'Send the reading', done: false }]
      })
    ]),
    'all'
  )
  assert.deepEqual(rows, [])
})

test('newest first, so the lane changes as the work does', () => {
  const rows = practising(
    notebook([
      note('old', 'A', 'open', [PRACTICE_TAG], 100),
      note('new', 'B', 'open', [PRACTICE_TAG], 900),
      note('mid', 'C', 'open', [PRACTICE_TAG], 500)
    ]),
    'all'
  )
  assert.deepEqual(rows.map((row) => row.id), ['new', 'mid', 'old'])
})

test('an archived principle is out of reach, flag or no flag', () => {
  const rows = practising(
    notebook([note('a', 'Listen longer', 'open', [PRACTICE_TAG], 0, { archived: true })]),
    'all'
  )
  assert.deepEqual(rows, [], 'filing it away has to mean it stays away')
})

test('the scope filter reaches it like every other list', () => {
  const index = notebook([note('a', 'Listen longer', 'open', [PRACTICE_TAG])])
  assert.equal(practising(index, 'W').length, 1)
  assert.equal(practising(index, 'P').length, 0, 'the category is Work')
})
