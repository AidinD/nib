/**
 * Tests for the full-text search.
 *
 * What it replaced: a search that matched the title and the preview, where the
 * preview is the first 200 characters of the note. Measured on a real notebook,
 * that was about 6% of what had been written - so a word in the middle of a
 * meeting note could not be found at all, and the search answered "nothing" to a
 * question the notebook could answer.
 *
 * Two rules are guarded here. A note matches on its text as readily as on its
 * title, and a one-character search does NOT reach into the bodies: with the
 * whole notebook in scope, one letter matches everything, and a list of
 * everything is the same as no answer.
 *
 * The third is about honesty on the card. A card whose every visible word is
 * missing the thing you typed reads as a broken search, so the matched line is
 * shown in place of the preview - which is what `searchSnippet` cuts.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BODY_SEARCH_MIN,
  matchesSearch,
  searchSnippet,
  selectedNotes
} from '../src/renderer/src/lib/selection.ts'

function note(over = {}) {
  return {
    id: 'n1',
    categoryId: 'c1',
    subId: null,
    title: 'Monday meeting',
    preview: 'We went through the quarter · nothing else',
    created: 1,
    edited: 1,
    pinned: false,
    tint: '',
    alerts: [],
    links: [],
    flag: '',
    kind: '',
    tags: [],
    archived: false,
    hasImage: false,
    hasDrawing: false,
    ...over
  }
}

function index(notes) {
  return {
    version: 2,
    categories: [
      { id: 'c1', name: 'Work', color: '#fff', scope: '', open: true, subs: [], notes }
    ],
    tags: [],
    templates: []
  }
}

/** The body text of a note, in the shape the search holds it. */
function body(text) {
  return { text, lower: text.toLowerCase() }
}

const ALL = { kind: 'all' }

test('a word only in the body is found', () => {
  const notes = [note()]
  const bodies = new Map([['n1', body('The contractor asked about the onboarding rota')]])

  // The old behaviour, and the reason this feature exists.
  assert.deepEqual(selectedNotes(index(notes), ALL, 'all', 'onboarding').map((n) => n.id), [])
  assert.deepEqual(
    selectedNotes(index(notes), ALL, 'all', 'onboarding', false, bodies).map((n) => n.id),
    ['n1']
  )
})

test('the title and the preview still match on their own', () => {
  const notes = [note()]
  assert.deepEqual(selectedNotes(index(notes), ALL, 'all', 'monday').map((n) => n.id), ['n1'])
  assert.deepEqual(selectedNotes(index(notes), ALL, 'all', 'quarter').map((n) => n.id), ['n1'])
})

test('the search is case-insensitive in the body too', () => {
  const bodies = new Map([['n1', body('The contractor asked about the Onboarding rota')]])
  assert.equal(matchesSearch(note(), 'ONBOARDING'.toLowerCase(), bodies), true)
})

test('one character does not reach into the bodies', () => {
  // It would match every note in the notebook. The title and the preview are
  // still matched from the first character, so typing widens rather than waits.
  const bodies = new Map([['n1', body('a rota nobody titled')]])
  assert.equal(BODY_SEARCH_MIN, 2)
  assert.equal(matchesSearch(note({ title: '', preview: '' }), 'r', bodies), false)
  assert.equal(matchesSearch(note({ title: '', preview: '' }), 'ro', bodies), true)
})

test('a note whose text has not been read yet simply does not match on it', () => {
  // The bodies arrive after the first keystroke. Holding the list back until
  // they land would make every search feel slow to protect a case that resolves
  // in about thirty milliseconds.
  assert.equal(matchesSearch(note({ title: '', preview: '' }), 'rota', undefined), false)
  assert.equal(matchesSearch(note({ title: '', preview: '' }), 'rota', new Map()), false)
})

test('an archived note is still only reached when the search is widened', () => {
  const notes = [note({ id: 'live' }), note({ id: 'old', archived: true })]
  const bodies = new Map([
    ['live', body('nothing here')],
    ['old', body('the rota we used to run')]
  ])
  assert.deepEqual(
    selectedNotes(index(notes), ALL, 'all', 'rota', false, bodies).map((n) => n.id),
    []
  )
  assert.deepEqual(
    selectedNotes(index(notes), ALL, 'all', 'rota', true, bodies).map((n) => n.id),
    ['old']
  )
})

test('the snippet is the match with a little either side', () => {
  const text = 'a '.repeat(60) + 'the onboarding rota' + ' b'.repeat(60)
  const snippet = searchSnippet(text, 'onboarding')
  assert.ok(snippet.includes('onboarding'))
  assert.ok(snippet.startsWith('…'), 'text carries on to the left')
  assert.ok(snippet.endsWith('…'), 'and to the right')
  assert.ok(snippet.length < 160, `kept short, got ${snippet.length}`)
})

test('a short note is shown whole, with no ellipses', () => {
  assert.equal(searchSnippet('the onboarding rota', 'onboarding'), 'the onboarding rota')
})

test('the snippet keeps the case it was written in', () => {
  // Matching is case-insensitive; showing is not. A snippet in lower case would
  // quietly rewrite a name.
  assert.equal(searchSnippet('Asked the contractor about Onboarding', 'onboarding'), 'Asked the contractor about Onboarding')
})

test('no match, no snippet', () => {
  assert.equal(searchSnippet('nothing of the sort', 'onboarding'), '')
})
