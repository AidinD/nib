/**
 * Tests for quick record's pure half: which folder is the Inbox, and what a
 * quick recording's note is called. The window, the hotkey and the recording
 * itself are in test/e2e/quick-record.steps.mjs.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { INBOX_NAME, QUICK_ACCELERATOR, findInbox, quickTitle } from '../src/shared/quick-record.ts'

const NOW = new Date(2026, 10, 27, 9, 5).getTime()

const folder = (id, name) => ({ id, name, color: 'blue', scope: '', open: true, subs: [], notes: [] })

describe('the Inbox', () => {
  it('is found by name, whatever its case or stray spaces', () => {
    const index = { version: 2, categories: [folder('a', 'Jobb'), folder('b', ' inbox ')], tags: [] }
    assert.equal(findInbox(index), 'b')
  })

  it('is missing in a notebook that never had one, so the first quick recording makes it', () => {
    assert.equal(findInbox({ version: 2, categories: [folder('a', 'Jobb')], tags: [] }), null)
  })

  it('is the first of two, rather than a new third', () => {
    const index = { version: 2, categories: [folder('a', INBOX_NAME), folder('b', INBOX_NAME)], tags: [] }
    assert.equal(findInbox(index), 'a')
  })
})

describe('the title', () => {
  it('is the typed name, trimmed', () => {
    assert.equal(quickTitle('  Kundsamtal ', NOW), 'Kundsamtal')
  })

  it('is the date and minute without one, so two in a day are not twins', () => {
    assert.equal(quickTitle('', NOW), '2026-11-27 09:05')
    assert.equal(quickTitle('   ', NOW), '2026-11-27 09:05')
  })
})

describe('the hotkey', () => {
  it('is Ctrl+Alt+comma - AltGr+comma types nothing on a Swedish keyboard', () => {
    assert.equal(QUICK_ACCELERATOR, 'Control+Alt+,')
  })
})
