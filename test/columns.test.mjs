/**
 * Tests for what a row of columns is corrected to.
 *
 * The count in `data-cols` is what the stylesheet lays out; the cells are where
 * the text actually is. Those two can disagree - not from typing, which only ever
 * changes them together, but from a note file written by something else, or by a
 * half-applied edit arriving through the synced folder while the app is open.
 *
 * The rule being guarded is which of the two wins. The cells do, always, because
 * believing the count instead is what would lose a column's text: a row that says
 * two and holds three would be laid out as two, and the third column would be
 * drawn off the side of a note that has no horizontal scroll.
 *
 * The second rule is the floor. A row left with one cell is not a row - it is one
 * narrow column of text with two thirds of the note empty beside it, and nothing
 * in the interface offers a way out of that shape. So it is taken apart, and
 * `unwrapColumns` keeps every line it held.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { columnFix, COLS_MAX, COLS_MIN } from '../src/renderer/src/lib/notes.ts'

test('the cells decide the count, not the attribute', () => {
  assert.deepEqual(columnFix(2), { unwrap: false, cols: 2 })
  assert.deepEqual(columnFix(3), { unwrap: false, cols: 3 })
})

test('a row with fewer than two cells is taken apart', () => {
  assert.equal(columnFix(1).unwrap, true)
  assert.equal(columnFix(0).unwrap, true)
})

test('cells past the third are kept, and wrap', () => {
  // Not merged and not dropped: whatever is written in a fourth column is
  // somebody's note. Three tracks means it lands on a second line of the grid,
  // which is untidy and readable - the two ways to be tidy here both lose text.
  const fix = columnFix(5)
  assert.equal(fix.unwrap, false)
  assert.equal(fix.cols, COLS_MAX)
})

test('the bounds are the ones the editor offers', () => {
  // A guard on the constants themselves, because the toolbar, the slash menu and
  // the stylesheet each write the numbers out separately: `2` and `3` in the
  // controls, `[data-cols='2']` and `[data-cols='3']` in the CSS. Widening the
  // range here without widening those would lay a row out as a single column.
  assert.equal(COLS_MIN, 2)
  assert.equal(COLS_MAX, 3)
})
