/**
 * The number that decides whether somebody acts.
 *
 * The audio is kept after transcription on purpose - a transcript comes back
 * about nine tenths right and the file is what lets you run it again - and the
 * cost of that decision was invisible. A meeting is 3.8 MB a minute, so a
 * thirty-nine minute one is a hundred and fifty, and nothing in the app said so.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { audioSize } from '../src/renderer/src/lib/selection.ts'

test('a real meeting, which is the case this exists for', () => {
  // The one that prompted it: 38:41, kept after transcription.
  assert.equal(audioSize(148_600_000), '149 MB')
  assert.equal(audioSize(116_500_000), '117 MB')
})

test('whole megabytes from ten up', () => {
  /*
   * "150 MB" is the number that makes somebody act; "149.7 MB" only asks to be
   * read. The decimal buys nothing at this size and costs a glance.
   */
  assert.equal(audioSize(10_000_000), '10 MB')
  assert.equal(audioSize(10_400_000), '10 MB')
  assert.equal(audioSize(99_900_000), '100 MB')
})

test('one decimal below it, so a short recording is not rounded to nothing', () => {
  assert.equal(audioSize(3_800_000), '3.8 MB')
  assert.equal(audioSize(9_990_000), '10.0 MB')
  assert.equal(audioSize(400_000), '0.4 MB')
})

test('megabytes even when it is barely any', () => {
  // Never kilobytes: a recording is never that small, and a unit that changes
  // between cards makes a column of sizes unreadable.
  assert.equal(audioSize(1), '0.0 MB')
  assert.equal(audioSize(0), '0.0 MB')
})
