/**
 * Tests for what a summary flags.
 *
 * The rule being guarded: NOTHING. A summary lists action points and flags none
 * of them, whether it summarised a meeting or a note.
 *
 * It used to flag a meeting's, on the reasoning that a promise made out loud and
 * left in a summary nobody reopens is not a promise. Two things were wrong with
 * that. A flagged line is an open promise in Tend, so the model's list became a
 * list its reader was answerable for before having read it - and summarising a
 * note about something already finished flagged "presented three arguments",
 * which is the past tense rather than a task. The exemption written for the
 * second was the whole rule.
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

test('nothing is flagged, and there is no way to ask for it to be', () => {
  const html = summaryHtml(PROVENANCE, VALUE)
  assert.equal(html.includes('data-alert'), false)
  // No second argument decides this any more. The parameter that used to is
  // gone, so a caller cannot turn flagging back on by passing 'meeting'.
  assert.equal(summaryHtml(PROVENANCE, VALUE, () => 'alert-1', 'meeting').includes('data-alert'), false)
})

test('the action points are still all there to read', () => {
  const html = summaryHtml(PROVENANCE, VALUE)
  assert.equal(html.includes('Boka om workshopen'), true)
  assert.equal(html.includes('Hor av dig till Nilsson'), true)
})

test('every action line is marked as one, so the control can find them', () => {
  const html = summaryHtml(PROVENANCE, VALUE)
  assert.equal((html.match(/data-action="1"/g) ?? []).length, 2)
})

test('the flag-all control is there whatever was summarised', () => {
  // It used to be a note's consolation for not being flagged. Now it is the only
  // way any summary's lines become action points without one gutter click each.
  assert.equal(summaryHtml(PROVENANCE, VALUE).includes('data-flag-all'), true)
})

test('an inferred commitment says so', () => {
  const html = summaryHtml(PROVENANCE, VALUE)
  assert.equal(html.includes('(underförstått)'), true)
  // And only the inferred one carries it.
  assert.equal((html.match(/\(underförstått\)/g) ?? []).length, 1)
})

test('the model that wrote it is named', () => {
  const html = summaryHtml(PROVENANCE, VALUE)
  assert.equal(html.includes('data-provenance="1"'), true)
  assert.equal(html.includes('claude-haiku-4-5'), true)
})

test('a summary with no actions gets no control', () => {
  const html = summaryHtml(PROVENANCE, { ...VALUE, actions: [] })
  assert.equal(html.includes('data-flag-all'), false)
  assert.equal(html.includes('Atgardspunkter'), false)
})
