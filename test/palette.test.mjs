/**
 * Tests that the palette's names and the stylesheet agree.
 *
 * A colour lives in two places by design: the name is in the note, as
 * `data-color="amber"`, and what that name looks like is in the stylesheet. That
 * is what lets a note be painted with no code running over it - a sticky window
 * shows the same colours from the same attributes - and it is also the one way
 * the feature can break quietly.
 *
 * A name with no rule is a swatch that paints nothing: the button lights, the
 * attribute lands in the note file, and the words look exactly as they did. There
 * is nothing to see and nothing in any log. A rule with no name is the harmless
 * direction, but it is dead weight and it is checked too, so the two lists stay
 * one list.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { HIGHLIGHTS, isPaintName, TEXT_COLORS, wordBounds } from '../src/renderer/src/lib/notes.ts'

const css = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')

/** The names the stylesheet has a rule for, for one of the two attributes. */
function styled(attribute) {
  return new Set(
    Array.from(css.matchAll(new RegExp(`\\[data-${attribute}='([a-z]+)'\\]`, 'g')), (hit) => hit[1])
  )
}

test('every text colour has a rule', () => {
  const rules = styled('color')
  for (const name of TEXT_COLORS) {
    assert.ok(rules.has(name), `no [data-color='${name}'] rule in the stylesheet`)
  }
})

test('every highlight has a rule', () => {
  const rules = styled('tint')
  for (const name of HIGHLIGHTS) {
    assert.ok(rules.has(name), `no [data-tint='${name}'] rule in the stylesheet`)
  }
})

test('and the stylesheet paints nothing the palette does not offer', () => {
  for (const name of styled('color')) {
    assert.ok(TEXT_COLORS.includes(name), `[data-color='${name}'] is styled but not offered`)
  }
  for (const name of styled('tint')) {
    assert.ok(HIGHLIGHTS.includes(name), `[data-tint='${name}'] is styled but not offered`)
  }
})

test('a name the app does not know is refused', () => {
  // The name ends up in an attribute in a note file, where a wrong one would
  // match no rule and be reported by nothing. Refusing it means a caller that
  // gets it wrong paints nothing, which is visible immediately.
  assert.equal(isPaintName('color', 'chartreuse'), false)
  assert.equal(isPaintName('color', 'amber'), true)
  // Each row has its own names: grey is offered as a text colour and not as a
  // highlight, so it has to be refused for one and allowed for the other.
  assert.equal(isPaintName('tint', 'grey'), false)
  assert.equal(isPaintName('color', 'grey'), true)
})

test('with nothing selected, a swatch acts on the word the caret is in', () => {
  // The caret in the middle of a word, and at either end of it.
  assert.deepEqual(wordBounds('paint this word', 8), { from: 6, to: 10 })
  assert.deepEqual(wordBounds('paint this word', 6), { from: 6, to: 10 })
  assert.deepEqual(wordBounds('paint this word', 10), { from: 6, to: 10 })
})

test('a word is what a reader would call one', () => {
  // Swedish letters are letters, and the apostrophes and hyphens that sit INSIDE
  // a word belong to it - "sjuk-anmalan" is one word to anyone reading it.
  assert.deepEqual(wordBounds('en fråga här', 4), { from: 3, to: 8 })
  assert.deepEqual(wordBounds('a well-known case', 7), { from: 2, to: 12 })
  assert.deepEqual(wordBounds("it doesn't matter", 6), { from: 3, to: 10 })
})

test('the caret between words paints nothing', () => {
  // `from === to` is the caller's signal to do nothing at all. Guessing a
  // neighbouring word would paint something nobody pointed at.
  assert.deepEqual(wordBounds('two  spaces', 4), { from: 4, to: 4 })
  assert.deepEqual(wordBounds('', 0), { from: 0, to: 0 })
})

test('grey is a text colour and not a highlight', () => {
  // A grey wash on a dark surface is a slightly different dark surface. As text it
  // means "less important", which is worth having.
  assert.ok(TEXT_COLORS.includes('grey'))
  assert.ok(!HIGHLIGHTS.includes('grey'))
})
