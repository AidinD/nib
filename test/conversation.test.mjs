/**
 * What kind of conversation it was, and what that removes.
 *
 * The failure being guarded is a small conversation given a big one's sections.
 * After a fourteen-minute catch-up about one ticket, "Sedan förra gången"
 * listed four unrelated open matters as things that went unraised and needed
 * raising next time - none of which belonged in a conversation about that
 * ticket. It read as findings and it was noise.
 *
 * The names here are invented. The real notebook's folders are named after
 * colleagues and this repository is public.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CONVERSATIONS,
  CONVERSATION_FALLBACK,
  conversationOf,
  guessConversation
} from '../src/shared/conversation.ts'
import { schemaFor } from '../src/main/summary.ts'

/* ------------------------------------------------------- the guess -- */

test('the 1-1 tag settles it, whatever the note is called', () => {
  // Not a guess at all: the template stamps the tag, so the note was started as
  // a one-to-one on purpose.
  assert.equal(guessConversation('Kaffe och prat', ['tag-one-to-one']), 'one-to-one')
  assert.equal(guessConversation('Onboarding Catchup', ['tag-one-to-one']), 'one-to-one')
})

test('a title that says 1-1 is read as one', () => {
  assert.equal(guessConversation('2026-09-09 1-1', []), 'one-to-one')
  assert.equal(guessConversation('1:1 med teamet', []), 'one-to-one')
  assert.equal(guessConversation('One to one', []), 'one-to-one')
})

test('the catch-up that started this is read as a check-in', () => {
  assert.equal(guessConversation('Onboarding Catchup', []), 'check-in')
  assert.equal(guessConversation('Avstämning om ticketsen', []), 'check-in')
})

test('a word has to start a word, not just appear inside one', () => {
  // "Onboarding Catchup" landed in the meeting bucket, because `onboarding`
  // ends in `board`. Found here rather than by reading the list.
  assert.equal(guessConversation('Onboarding Catchup', []), 'check-in')
  assert.equal(guessConversation('Dashboard-genomgång', []), 'check-in')
})

test('a meeting and a status update are told apart', () => {
  assert.equal(guessConversation('Retro sprint 14', []), 'meeting')
  assert.equal(guessConversation('Workshop om onboarding', []), 'meeting')
  assert.equal(guessConversation('Statusuppdatering Q3', []), 'status')
  assert.equal(guessConversation('Daily', []), 'status')
})

test('an unrecognised title gets the NARROWEST kind, not the richest', () => {
  /*
   * Which way round this falls is the whole safety of guessing at all. Too
   * little is a quiet loss - a section that could have been useful is missing,
   * and the choice is one click away in the panel. Too much is the loud one that
   * was reported.
   */
  assert.equal(guessConversation('', []), 'check-in')
  assert.equal(guessConversation('2026-09-10', []), 'check-in')
  assert.equal(guessConversation('Något helt annat', []), 'check-in')
  assert.equal(CONVERSATION_FALLBACK, 'check-in')
})

test('an unknown kind resolves to the fallback rather than to nothing', () => {
  assert.equal(conversationOf(undefined).id, 'check-in')
  assert.equal(conversationOf('nonsense').id, 'check-in')
})

/* ------------------------------------------------ what it removes -- */

test('a check-in is not given a last time or questions to fill', () => {
  const schema = schemaFor('check-in')
  assert.equal('lastTime' in schema.properties, false, 'no field, not an instruction')
  assert.equal('questions' in schema.properties, false)
  assert.equal(schema.required.includes('questions'), false, 'nor required to produce them')
})

test('a one-to-one keeps both, because that is what it is for', () => {
  const schema = schemaFor('one-to-one')
  assert.equal('lastTime' in schema.properties, true)
  assert.equal('questions' in schema.properties, true)
  assert.equal(schema.required.includes('questions'), true)
})

test('a meeting asks what nobody asked, but has no last time', () => {
  const schema = schemaFor('meeting')
  assert.equal('lastTime' in schema.properties, false, 'a one-off has no previous')
  assert.equal('questions' in schema.properties, true)
})

test('a status update gets neither', () => {
  const schema = schemaFor('status')
  assert.equal('lastTime' in schema.properties, false)
  assert.equal('questions' in schema.properties, false)
})

test('what every kind keeps, whatever it is', () => {
  // Decisions, actions and the summary itself are not a function of the kind:
  // a conversation of any shape can settle something or leave a promise.
  for (const kind of CONVERSATIONS) {
    const schema = schemaFor(kind.id)
    for (const field of ['summary', 'decisions', 'actions', 'people']) {
      assert.ok(field in schema.properties, `${kind.id} lost ${field}`)
      assert.ok(schema.required.includes(field), `${kind.id} stopped requiring ${field}`)
    }
  }
})

test('every kind says something about itself for the prompt', () => {
  for (const kind of CONVERSATIONS) {
    assert.ok(kind.says.length > 40, `${kind.id} has nothing to tell the model`)
    assert.ok(kind.label.length > 0 && kind.hint.length > 0, `${kind.id} is unlabelled`)
  }
})
