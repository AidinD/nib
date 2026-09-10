/**
 * The model's own scaffolding, left on the end of what it wrote.
 *
 * The shapes here are the real ones, found in three of a hundred and
 * thirty-five notes on 2026-09-10: a summary ending in a closing `summary` tag,
 * twice with a closing `invoke` tag under it. The second is what identifies the
 * whole thing - that is the shape of a tool call, not of a note about a meeting.
 *
 * It survives because the schema is enforced by the CLI, so what comes back is a
 * perfectly valid string and nothing that checks the shape can see it; and it
 * reaches the page because the summary is escaped on the way into the note,
 * exactly as it should be, so the reader gets the tag as literal text.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { tidy, tidyAnswer } from '../src/main/summary.ts'

const NL = '\n'

const clean = {
  summary: 'Ett kort referat.',
  decisions: [],
  actions: [],
  questions: [],
  people: []
}

test('a closing tag on the end of the summary comes off', () => {
  const fixed = tidyAnswer({ ...clean, summary: 'Avslutades med privat snack.</summary>' })
  assert.equal(fixed.summary, 'Avslutades med privat snack.')
})

test('the whole run comes off, newlines and all', () => {
  // Exactly as it arrived: two orphans stacked, each on its own line.
  const fixed = tidyAnswer({
    ...clean,
    summary: `Avslutades med privat snack om bastu.${NL}</summary>${NL}</invoke>${NL}`
  })
  assert.equal(fixed.summary, 'Avslutades med privat snack om bastu.')
})

test('every field is tidied, not only the summary', () => {
  const fixed = tidyAnswer({
    summary: 'Referat.</summary>',
    decisions: ['Vi kör vidare.</summary>'],
    actions: [{ text: 'Ta upp pivoten.</invoke>', implied: false }],
    questions: ['Vem täcker upp?</summary>'],
    people: ['Ada'],
    lastTime: 'Förra gången.</summary>',
    answers: [{ id: 'p1', answer: 'Han sa ja.</summary>' }]
  })
  assert.equal(fixed.decisions[0], 'Vi kör vidare.')
  assert.equal(fixed.actions[0].text, 'Ta upp pivoten.')
  assert.equal(fixed.questions[0], 'Vem täcker upp?')
  assert.equal(fixed.lastTime, 'Förra gången.')
  assert.equal(fixed.answers[0].answer, 'Han sa ja.')
})

test('markup somebody actually wrote is left alone', () => {
  /*
   * The whole test of this is whether the closing tag has an opening one before
   * it in the same field. Real markup comes in pairs; scaffolding that leaked
   * does not, because its opening half was consumed as scaffolding. Which is
   * also why nothing has to be added here when the model leaks a tag nobody has
   * seen yet.
   */
  const paired = 'Han skrev <p>hej</p>'
  assert.equal(tidy(paired), paired)
  const spelled = 'Taggen <summary> öppnar och </summary>'
  assert.equal(tidy(spelled), spelled)
})

test('a tag in the middle is not on the end, and stays', () => {
  const kept = 'Vi pratade om </summary> och sedan om annat.'
  assert.equal(tidy(kept), kept)
})

test('an answer with nothing on the end comes back untouched', () => {
  const value = { ...clean, summary: 'Ett kort referat.' }
  assert.equal(tidyAnswer(value), value, 'the same object, not a rebuilt equal one')
})

test('an unfamiliar tag needs no list to be recognised', () => {
  // The point of testing for an orphan rather than for a name: the next token
  // the model leaks will not be one anybody has written down here.
  assert.equal(tidy(`Klart.${NL}</thinking>${NL}`), 'Klart.')
})

test('a field that is nothing but scaffolding is emptied, not kept', () => {
  // Nothing of the person's is lost, because there was nothing of theirs in it.
  assert.equal(tidy('</invoke>'), '')
})
