/**
 * Tests for what a summary flags.
 *
 * The rule being guarded: a meeting's action points flag themselves, a note's do
 * not. Summarising a note about something that had already happened produced two
 * flagged lines describing what the writer DID - the past tense rather than a
 * task - and a flagged line becomes an open promise in Tend.
 * Listing them is useful; committing the writer to them is not a decision the
 * summary gets to make.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { summaryHtml } from '../src/renderer/src/lib/notes.ts'

const PROVENANCE = { model: 'claude-haiku-4-5', costUsd: 0.043 }

const VALUE = {
  summary: 'Vad noten sager.',
  decisions: [],
  actions: [
    { text: 'Boka om workshopen', implied: false },
    { text: 'Hor av dig till Nilsson', implied: true }
  ],
  questions: [],
  people: []
}

let counter = 0
const ids = () => `alert-${++counter}`

test('a meeting flags its action points', () => {
  counter = 0
  const html = summaryHtml(PROVENANCE, VALUE, ids, 'meeting')
  assert.equal((html.match(/data-alert="1"/g) ?? []).length, 2)
  assert.equal((html.match(/data-alert-id="alert-\d"/g) ?? []).length, 2)
})

test('a note lists them without flagging them', () => {
  counter = 0
  const html = summaryHtml(PROVENANCE, VALUE, ids, 'note')
  assert.equal(html.includes('data-alert'), false)
  // Still there to read, and one click each turns one into a real action point.
  assert.equal(html.includes('Boka om workshopen'), true)
  assert.equal(html.includes('Hor av dig till Nilsson'), true)
})

test('an inferred commitment says so in both', () => {
  for (const kind of ['meeting', 'note']) {
    counter = 0
    const html = summaryHtml(PROVENANCE, VALUE, ids, kind)
    assert.equal(html.includes('(underförstått)'), true, kind)
    // And only the inferred one carries it.
    assert.equal((html.match(/\(underförstått\)/g) ?? []).length, 1, kind)
  }
})

test('the model that wrote it is named, whatever the kind', () => {
  for (const kind of ['meeting', 'note']) {
    const html = summaryHtml(PROVENANCE, VALUE, ids, kind)
    assert.equal(html.includes('data-provenance="1"'), true, kind)
    assert.equal(html.includes('claude-haiku-4-5'), true, kind)
  }
})

test('a note gets the flag-all control, a meeting does not', () => {
  counter = 0
  assert.equal(summaryHtml(PROVENANCE, VALUE, ids, 'note').includes('data-flag-all'), true)
  counter = 0
  assert.equal(summaryHtml(PROVENANCE, VALUE, ids, 'meeting').includes('data-flag-all'), false)
})

test('every action line is marked as one, flagged or not', () => {
  for (const kind of ['meeting', 'note']) {
    counter = 0
    const html = summaryHtml(PROVENANCE, VALUE, ids, kind)
    assert.equal((html.match(/data-action="1"/g) ?? []).length, 2, kind)
  }
})

test('a summary with no actions gets no control', () => {
  counter = 0
  const html = summaryHtml(PROVENANCE, { ...VALUE, actions: [] }, ids, 'note')
  assert.equal(html.includes('data-flag-all'), false)
  assert.equal(html.includes('Atgardspunkter'), false)
})

test('meeting is the default, so an old caller keeps flagging', () => {
  counter = 0
  const html = summaryHtml(PROVENANCE, VALUE, ids)
  assert.equal((html.match(/data-alert="1"/g) ?? []).length, 2)
})
