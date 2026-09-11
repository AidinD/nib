/**
 * The receipt a move leaves behind.
 *
 * It matters more than its size suggests: the block simply vanishes from the
 * note you are looking at, and without a line naming what went and where, that
 * reads as a delete. "And 2 more" is not a receipt - two more of what, and would
 * you have noticed if it had said one?
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { movedLine } from '../src/renderer/src/lib/notes.ts'

test('a recording on its own', () => {
  assert.equal(movedLine({ transcript: false, marks: 0 }), 'Inspelningen flyttades')
})

test('a recording and its transcript', () => {
  assert.equal(
    movedLine({ transcript: true, marks: 0 }),
    'Inspelningen och transkriptet flyttades'
  )
})

test('and the moments pinned to it, counted in words where there is one', () => {
  assert.equal(
    movedLine({ transcript: true, marks: 1 }),
    'Inspelningen, transkriptet och ett markerat ögonblick flyttades'
  )
  assert.equal(
    movedLine({ transcript: true, marks: 3 }),
    'Inspelningen, transkriptet och 3 markerade ögonblick flyttades'
  )
})

test('marks with no transcript, which is a recording never turned into text', () => {
  assert.equal(
    movedLine({ transcript: false, marks: 2 }),
    'Inspelningen och 2 markerade ögonblick flyttades'
  )
})
