/**
 * Tests for where a recording's block lands in the note.
 *
 * The rule being guarded is not "at the top" - it is that recorded order and
 * document order are the same thing. Document order is what pairs a transcript
 * with its own recording block in `transcriptsWithMarks`, and what tells the
 * summary which half of a two-recording conversation came first. Prepending
 * unconditionally would read fine on screen and quietly hand the summary a
 * meeting back to front.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { blockKind, recordingInsertAt } from '../src/renderer/src/lib/notes.ts'

/**
 * Enough of an element for `blockKind`, which asks two things of one.
 *
 * There is no DOM in these tests - `npm test` runs against `src/` with no app -
 * and the two shapes that matter here are shapes, not rendering: a block that
 * carries the attribute itself, and a paragraph that merely contains one.
 */
function child(own, contains = []) {
  return {
    dataset: Object.fromEntries(own.map((name) => [name, '1'])),
    querySelector: (selector) =>
      contains.some((name) => selector === `[data-${name}]`) ? {} : null
  }
}

test('an empty note takes the block at the top', () => {
  assert.equal(recordingInsertAt([]), 0)
})

test('a note holding only what you typed takes it above all of it', () => {
  // The case this change exists for: nine screenshots marked during a meeting,
  // and the recording used to land under the last of them.
  assert.equal(recordingInsertAt(['other', 'other', 'other']), 0)
})

test('a summary keeps its place at the very top', () => {
  // The summary is an account of the meeting and the transcript is the meeting.
  assert.equal(recordingInsertAt(['summary', 'other']), 1)
})

test('a second recording goes after the first, not above it', () => {
  assert.equal(recordingInsertAt(['recording', 'other']), 1)
})

test("a second recording clears the first one's transcript too", () => {
  // Adjacency is what makes a transcript findable from its own block.
  assert.equal(recordingInsertAt(['recording', 'transcript', 'other']), 2)
  assert.equal(recordingInsertAt(['summary', 'recording', 'transcript', 'other']), 3)
})

test('a gap between a block and its own transcript is not a place to insert', () => {
  /*
   * Taken from a real note. A half-hour meeting saved as
   * `<div data-recording><p></p><details data-transcript>` - an empty paragraph
   * between the two, left behind by the place-to-type the old code appended. A
   * rule that looked only at the child right after the block would put the next
   * recording in that gap, and a transcript preceded by the wrong recording
   * block is every screenshot filed under the wrong meeting.
   */
  assert.equal(recordingInsertAt(['recording', 'other', 'transcript']), 3)
  assert.equal(recordingInsertAt(['other', 'recording', 'other', 'transcript', 'other']), 4)
})

test('a recording not yet transcribed keeps the next one right behind it', () => {
  // Nothing to skip past here, and the scan must not run off to the end of the
  // note looking for a transcript that does not exist yet.
  assert.equal(recordingInsertAt(['recording', 'other', 'other']), 1)
})

test('a third recording goes after the second', () => {
  assert.equal(
    recordingInsertAt(['summary', 'recording', 'transcript', 'recording', 'transcript', 'other']),
    5
  )
})

test('a transcript whose block was deleted still holds its place', () => {
  // The block can be removed like anything else in the note. The transcript is
  // then the last word on where the recorded material ends.
  assert.equal(recordingInsertAt(['transcript', 'other']), 1)
})

test('a transcript read back from disk is still a transcript', () => {
  /*
   * The one that would have broken it quietly. A fresh transcript is a `details`
   * sitting directly in the body, but a saved one comes back wrapped in a
   * paragraph - so the child standing for it carries no attribute of its own. An
   * own-attribute check would have called it 'other', and the second recording of
   * a reopened note would have been filed above the first one's transcript.
   */
  assert.equal(blockKind(child([], ['transcript'])), 'transcript')
  assert.equal(blockKind(child(['transcript'])), 'transcript')
  assert.equal(blockKind(child(['recording'])), 'recording')
  assert.equal(blockKind(child(['summary'])), 'summary')
  assert.equal(blockKind(child([])), 'other')
})

test('an image marked during the meeting is not mistaken for a block', () => {
  // A moment is an `img` with `data-at` and `data-rec` on it. `data-rec` is close
  // enough to `data-recording` to be worth a test rather than a glance.
  assert.equal(blockKind(child(['at', 'rec'])), 'other')
})

test('the shape a real meeting note actually loads as', () => {
  /*
   * Measured, not imagined. A note with three moments, a block, its transcript
   * and the trailing place-to-type came back out of the running app as exactly
   * this - read off the live DOM over the debugging port, `p p p div p p p`. The
   * transcript is the sixth child and it is a paragraph, because a saved
   * transcript is wrapped in one on load even though it sits at top level on
   * disk. Pinned here so the rule is checked against the app's real output
   * rather than against what the note file looks like.
   */
  const measured = ['other', 'other', 'other', 'recording', 'other', 'transcript', 'other']
  assert.equal(recordingInsertAt(measured), 6)
})

test('an older note, whose recording is at the bottom, is left alone', () => {
  // Nothing reorders what is already written. A note made before this change has
  // its block under the typing, and a second recording still goes below it -
  // which is both where it used to go and the only place that keeps the order.
  assert.equal(recordingInsertAt(['other', 'other', 'recording', 'transcript']), 4)
})
