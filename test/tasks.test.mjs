/**
 * Tests for checklists: the typed prefix, the tick, the text a reader sees, and
 * where a click counts as a click on the box.
 *
 * The rules being guarded: `[]`, `[ ]` and `[x]` start an item and nothing else
 * does - including the non-breaking space Chromium writes for a space typed at
 * the end of a line; a tick toggles between exactly two states; a reader of the
 * note as text gets markdown's own `[ ]` and `[x]`; and a click beside a
 * sub-item reaches the sub-item, not the parent whose box is level with it only
 * because the parent is as tall as its whole sub-list.
 *
 * The DOM half - the attribute surviving a save and a reload, the box drawn and
 * clicked - is proven in the running app with scripts/e2e.mjs, since these tests
 * run without a document.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { nextTaskState, onTaskBox, taskPrefixState } from '../src/renderer/src/lib/tasks.ts'
import { activeFormats, taskMarker } from '../src/renderer/src/lib/notes.ts'

test('the three markdown spellings start a checklist item', () => {
  assert.equal(taskPrefixState('[]'), 'open')
  assert.equal(taskPrefixState('[ ]'), 'open')
  assert.equal(taskPrefixState('[x]'), 'done')
  assert.equal(taskPrefixState('[X]'), 'done')
})

test('a non-breaking space inside the brackets counts as a space', () => {
  // What Chromium leaves behind for `[ ` typed at the end of a line.
  assert.equal(taskPrefixState('[ ]'), 'open')
})

test('anything else is prose, not a checklist', () => {
  assert.equal(taskPrefixState('['), null)
  assert.equal(taskPrefixState('[  ]'), null)
  assert.equal(taskPrefixState('[y]'), null)
  assert.equal(taskPrefixState('a [ ]'), null)
  assert.equal(taskPrefixState('[ ] a'), null)
  assert.equal(taskPrefixState(''), null)
})

test('a tick toggles between open and done', () => {
  assert.equal(nextTaskState('open'), 'done')
  assert.equal(nextTaskState('done'), 'open')
  // Anything unexpected in the file is treated as not done, so one click makes it a real state.
  assert.equal(nextTaskState(undefined), 'open')
  assert.equal(nextTaskState('1'), 'open')
})

test('a reader of the note as text sees markdown task markers', () => {
  assert.equal(taskMarker('done'), '[x] ')
  assert.equal(taskMarker('open'), '[ ] ')
})

test('the box is the strip to the left of the item, level with its first line', () => {
  const item = { left: 100, top: 50, bottom: 200 }
  // In the indent, on the first line.
  assert.equal(onTaskBox(item, 24, 22, 85, 60), true)
  // In the text, past the slack.
  assert.equal(onTaskBox(item, 24, 22, 110, 60), false)
  // Further left than the indent: that is the alert flag's column.
  assert.equal(onTaskBox(item, 24, 22, 70, 60), false)
})

test('a click beside a sub-item does not tick the parent', () => {
  // The parent is as tall as its sub-list; only its first line is its box.
  const parent = { left: 100, top: 50, bottom: 200 }
  assert.equal(onTaskBox(parent, 24, 22, 85, 120), false)
})

test('a checklist item lights Checklist, not Bullets', () => {
  const marks = {
    block: 'LI',
    list: 'UL',
    task: true,
    quoted: false,
    code: false,
    color: '',
    tint: '',
    bold: false,
    italic: false,
    underline: false,
    strike: false
  }
  assert.deepEqual(activeFormats(marks), ['checklist'])
  assert.deepEqual(activeFormats({ ...marks, task: false }), ['bullets'])
})
