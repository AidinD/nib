/**
 * Tests for which toolbar buttons the caret lights up.
 *
 * The toolbar used to be write-only: it offered to make a heading and never said
 * whether you were standing in one. This is the mapping from the caret's
 * surroundings to the buttons that show as active, kept as a pure function so
 * every case can be stated without a document.
 *
 * The case worth guarding is `body`. It means a plain paragraph, and the blocks
 * inside a quote and inside a list item are often paragraphs too - so answering
 * "is this a paragraph" from the tag alone lit Body next to a lit Quote and said
 * the line was both.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { activeFormats } from '../src/renderer/src/lib/notes.ts'

/** A caret in a plain paragraph, with nothing else switched on. */
function marks(over = {}) {
  return {
    block: 'P',
    list: '',
    quoted: false,
    code: false,
    color: '',
    tint: '',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    ...over
  }
}

test('a plain paragraph lights Body and nothing else', () => {
  assert.deepEqual(activeFormats(marks()), ['body'])
})

test('a heading lights its own level', () => {
  assert.deepEqual(activeFormats(marks({ block: 'H2' })), ['h2'])
  assert.deepEqual(activeFormats(marks({ block: 'H1' })), ['h1'])
})

test('a fourth-level heading lights nothing - the toolbar has no button for it', () => {
  // H4 exists in notes that came from a paste. Lighting H3 for it would be a lie
  // about which button would leave the line as it is.
  assert.deepEqual(activeFormats(marks({ block: 'H4' })), [])
})

test('a paragraph inside a quote is a quote, not body text', () => {
  assert.deepEqual(activeFormats(marks({ quoted: true })), ['quote'])
})

test('a list item lights the kind of list it is in', () => {
  assert.deepEqual(activeFormats(marks({ block: 'LI', list: 'UL' })), ['bullets'])
  assert.deepEqual(activeFormats(marks({ block: 'LI', list: 'OL' })), ['numbers'])
})

test('a paragraph that sits inside a list is not body text either', () => {
  assert.deepEqual(activeFormats(marks({ list: 'UL' })), ['bullets'])
})

test('the inline marks stack on the block', () => {
  assert.deepEqual(activeFormats(marks({ bold: true, italic: true })), [
    'body',
    'bold',
    'italic'
  ])
  assert.deepEqual(activeFormats(marks({ block: 'H2', bold: true })), ['h2', 'bold'])
})

test('code, underline and strikethrough each light their own', () => {
  assert.deepEqual(activeFormats(marks({ code: true })), ['body', 'code'])
  assert.deepEqual(activeFormats(marks({ underline: true })), ['body', 'underline'])
  assert.deepEqual(activeFormats(marks({ strike: true })), ['body', 'strike'])
})

test('a coloured or highlighted run lights its button', () => {
  // The button says only THAT there is a colour; which one it is belongs to the
  // swatch row, which reads the name off the marks directly.
  assert.deepEqual(activeFormats(marks({ color: 'amber' })), ['body', 'color'])
  assert.deepEqual(activeFormats(marks({ tint: 'green' })), ['body', 'highlight'])
  assert.deepEqual(activeFormats(marks({ color: 'red', tint: 'red' })), [
    'body',
    'color',
    'highlight'
  ])
})

test('outside any block, nothing is lit', () => {
  // The caret is in no block at all - loose text under the body, or a selection
  // that starts outside the note. Guessing here would light a button for a line
  // that does not exist.
  assert.deepEqual(activeFormats(marks({ block: '' })), [])
})
