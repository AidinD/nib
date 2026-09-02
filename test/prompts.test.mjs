/**
 * Tests for the note's own questions, and where their answers land.
 *
 * The rule being guarded is that the unit is the LINE. A prompt in the 1-1
 * template holds more than one question - "Hur går det med det vi kom överens om
 * förra gången? Något som behöver ändras?" is one thing a person asks - and one
 * section can hold two separate prompt lines, because the fortnightly rotation
 * writes both weeks into the note and the one that does not apply is deleted.
 *
 * Split on the question mark and you get four half-answers to six questions. Key
 * on the heading and "Energi och friktion" gets one answer where it needs two.
 * Both of those read fine and are wrong, which is why they are pinned here.
 *
 * The second rule: an answer goes BELOW what the user typed, never over it. What
 * they wrote during the conversation is a judgement made while it was happening,
 * and this feature is not allowed to overwrite one.
 *
 * No DOM - `npm test` runs against `src/` with no app - so these run against the
 * list of kinds, the same split `recordingInsertAt` uses.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { promptLayout } from '../src/renderer/src/lib/notes.ts'

/**
 * The shipped 1-1 template, as kinds.
 *
 * Six headings, eight prompt lines - "Energi och friktion" and "Karriär och
 * utveckling" carry two each, one per week of the rotation. Taken from
 * `ONE_TO_ONE_BODY` rather than invented, because the shape of that constant is
 * the thing this has to work on today.
 */
const ONE_TO_ONE = [
  'heading', 'prompt',            // Uppföljning
  'heading', 'prompt',            // Öppen space
  'heading', 'prompt', 'prompt',  // Energi och friktion - Vecka 1, Vecka 2
  'heading', 'prompt',            // Relationer och feedback
  'heading', 'prompt', 'prompt',  // Karriär och utveckling - Vecka 1, Vecka 2
  'heading', 'prompt'             // Något annat
]

test('every prompt line is its own question, including two under one heading', () => {
  const plans = promptLayout(ONE_TO_ONE)
  // Eight lines, not six headings and not the fourteen question marks in them.
  assert.equal(plans.length, 8)
  assert.deepEqual(
    plans.map((plan) => plan.id),
    ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']
  )
})

test('the two lines under one heading are two questions under that heading', () => {
  const plans = promptLayout(ONE_TO_ONE)
  const energy = plans.filter((plan) => plan.heading === 4)
  assert.equal(energy.length, 2)
  // Different questions, same heading. Vecka 1 and Vecka 2 are not one thing.
  assert.deepEqual(
    energy.map((plan) => plan.question),
    [5, 6]
  )
})

test('an untouched prompt takes its answer directly under the question', () => {
  const [first] = promptLayout(ONE_TO_ONE)
  assert.equal(first.anchor, 1)
  assert.deepEqual(first.existing, [])
})

test('what you typed during the meeting keeps the answer below it', () => {
  // The case the whole placement rule exists for: notes jotted under a prompt
  // while the conversation ran.
  const plans = promptLayout(['heading', 'prompt', 'text', 'text'])
  assert.equal(plans.length, 1)
  assert.deepEqual(plans[0].existing, [2, 3])
  // Under the last of them, so nothing they wrote is displaced.
  assert.equal(plans[0].anchor, 3)
})

test('your notes under one line do not leak into the next question', () => {
  const plans = promptLayout(['heading', 'prompt', 'text', 'prompt', 'text'])
  assert.deepEqual(plans[0].existing, [2])
  assert.deepEqual(plans[1].existing, [4])
  assert.equal(plans[0].anchor, 2)
  assert.equal(plans[1].anchor, 4)
})

test('a trailing blank line is not where an answer goes', () => {
  // An answer wedged under a blank reads as belonging to the next question.
  const plans = promptLayout(['heading', 'prompt', 'text', 'empty'])
  assert.equal(plans[0].anchor, 2)
})

test("a second run replaces its own answer rather than adding another", () => {
  const plans = promptLayout(['heading', 'prompt', 'text', 'filled'])
  assert.deepEqual(plans[0].filled, [3])
  // The anchor is the user's line, never the answer being replaced - so removing
  // the stale one cannot strand the insertion point.
  assert.equal(plans[0].anchor, 2)
  assert.deepEqual(plans[0].existing, [2])
})

test('a previous answer is not read back as something you wrote', () => {
  const plans = promptLayout(['heading', 'prompt', 'filled'])
  assert.deepEqual(plans[0].existing, [])
  assert.deepEqual(plans[0].filled, [2])
  assert.equal(plans[0].anchor, 1)
})

test('a heading with no question under it is not a question', () => {
  // "Anteckningar" with prose under it asked nothing, and filling it in would be
  // the model writing into structure that was never a prompt.
  assert.deepEqual(promptLayout(['heading', 'text', 'text']), [])
})

test('a heading that is itself a question counts when nothing else asks', () => {
  // Somebody writing their own template as bare headings.
  const plans = promptLayout(['asking-heading', 'text'])
  assert.equal(plans.length, 1)
  assert.equal(plans[0].question, 0)
  assert.equal(plans[0].anchor, 1)
})

test('a question-mark heading adds no phantom question where lines exist', () => {
  // The fallback is a fallback. A section with real prompt lines has exactly as
  // many questions as it has lines.
  const plans = promptLayout(['asking-heading', 'prompt', 'prompt'])
  assert.equal(plans.length, 2)
  assert.deepEqual(
    plans.map((plan) => plan.question),
    [1, 2]
  )
})

test('a note with nothing in it has nothing to answer', () => {
  assert.deepEqual(promptLayout([]), [])
  assert.deepEqual(promptLayout(['text', 'empty']), [])
})

test('a prompt before any heading is still a question', () => {
  const plans = promptLayout(['prompt', 'text'])
  assert.equal(plans.length, 1)
  assert.equal(plans[0].heading, -1)
  assert.equal(plans[0].anchor, 1)
})
