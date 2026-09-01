/**
 * Tests for what can be flagged.
 *
 * The rule being guarded: a generated summary's own headings cannot become action
 * points. Not because flagging them looks wrong, but because a flag is an entry in
 * `index.json` and from there a promise in Tend - so flagging the word
 * "Sammanfattning" filed 160 characters of a meeting summary as something the
 * author had committed to.
 *
 * It happened in a real note on 2026-09-01. The gutter runs the whole height of
 * the document's left margin, so a stray click level with the first heading
 * flagged it, and the three-state cycle - flag, done, gone - turned the attempt
 * to undo it into a green tick.
 *
 * The second rule matters as much as the first: this refuses to CREATE a flag and
 * says nothing about clearing one, so the note that reported the problem is still
 * one click from being fixed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isSummaryHeading } from '../src/renderer/src/lib/notes.ts'

/** Enough of a block for the check, which asks a tag name and one ancestor. */
function block(tagName, inSummary) {
  return { tagName, closest: (selector) => (inSummary && selector === '[data-summary]' ? {} : null) }
}

test("a summary's headings are not action points", () => {
  for (const tag of ['H1', 'H2', 'H3', 'H4']) {
    assert.equal(isSummaryHeading(block(tag, true)), true, tag)
  }
})

test('a heading in the note itself still is one', () => {
  // The guard is about generated structure, not about headings. A heading you
  // typed is a line like any other, and flagging one is how a whole section gets
  // marked as needing you.
  assert.equal(isSummaryHeading(block('H2', false)), false)
})

test("a summary's action lines and prose are untouched", () => {
  // The action points are the entire reason the summary is worth flagging, and
  // the prose is a judgement call left to whoever is reading it.
  assert.equal(isSummaryHeading(block('P', true)), false)
  assert.equal(isSummaryHeading(block('LI', true)), false)
  assert.equal(isSummaryHeading(block('BLOCKQUOTE', true)), false)
})
