/**
 * A transcript is a block, and for a long time this rule did not think so.
 *
 * `adoptLooseText` gathers everything that is not a block into a paragraph, and
 * its list of block tags left out `details` - which is what a transcript is. So
 * every load wrapped the whole transcript in a `<p>`.
 *
 * It never reached disk, and that is why it went unnoticed: `<p><details>` is
 * not valid HTML, so saving - which serialises and re-parses - closes the
 * paragraph in front of the details. The empty paragraph before every transcript
 * in the real notebook is the fossil of it. Harmless right up until something
 * read the live DOM and expected the transcript to be the top-level block it is
 * on disk, which is what moving a recording to another note does.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isBlockTag } from '../src/renderer/src/lib/notes.ts'

test('a transcript is a block, which is the whole point of this file', () => {
  assert.equal(isBlockTag('DETAILS'), true)
})

test('everything else a note is built out of is one too', () => {
  for (const tag of ['P', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'HR', 'DIV', 'TABLE']) {
    assert.equal(isBlockTag(tag), true, `${tag} stopped being a block`)
  }
})

test('inline text is not, which is what the gathering is for', () => {
  // The rule exists for a paste that arrives as bare text and spans: without it
  // those sit at the top level where nothing can style or flag them.
  for (const tag of ['SPAN', 'EM', 'STRONG', 'A', 'CODE', 'IMG', 'MARK', 'SUMMARY']) {
    assert.equal(isBlockTag(tag), false, `${tag} started counting as a block`)
  }
})

test('the test is on the tag name exactly, not on a substring of it', () => {
  assert.equal(isBlockTag('PRESENTATION'), false)
  assert.equal(isBlockTag('P2'), false)
  assert.equal(isBlockTag('p'), false, 'tagName is upper case in an HTML document')
})
