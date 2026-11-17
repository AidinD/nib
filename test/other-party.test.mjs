/**
 * The other person's part of a conversation - what they did well and what less
 * well - and where it is allowed to appear at all.
 *
 * Guarded: the field exists in the schema only for a 1-1 and a conversation
 * with the user's own manager, never for a check-in, a meeting, a status update
 * or a note summarised as a note; a conversation filed in a manager folder is
 * guessed as one; a point survives only if its quote is really in the
 * transcript; and an empty list renders as nothing, not as an empty heading.
 *
 * Every name and line here is invented.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { guessConversation } from '../src/shared/conversation.ts'
import { instruction, keepQuoted, quotedSpeakers, schemaFor } from '../src/main/summary.ts'
import { summaryHtml } from '../src/renderer/src/lib/notes.ts'

const has = (schema, field) => field in schema.properties && schema.required.includes(field)

test('only a 1-1 and a conversation with the manager have the field', () => {
  assert.equal(has(schemaFor('one-to-one'), 'theirs'), true)
  assert.equal(has(schemaFor('manager'), 'theirs'), true)
  for (const kind of ['check-in', 'meeting', 'status']) {
    assert.equal('theirs' in schemaFor(kind).properties, false, kind)
  }
})

test('a note summarised as a note never has it, whatever it is filed as', () => {
  assert.equal('theirs' in schemaFor('one-to-one', 'note').properties, false)
  assert.equal('theirs' in schemaFor('manager', 'note').properties, false)
})

test('every point must carry a quote', () => {
  const item = schemaFor('manager').properties.theirs.items
  assert.deepEqual(item.required, ['verdict', 'point', 'quote'])
})

test('a conversation filed in a manager folder is guessed as one', () => {
  // Titled by date and tagged as a meeting: only the folder says who it was with.
  assert.equal(guessConversation('2026-03-02', ['tag-meeting'], 'Manager möte'), 'manager')
  assert.equal(guessConversation('Avstämning', [], 'Chefssamtal'), 'manager')
  assert.equal(guessConversation('2026-03-02', [], 'Kim'), 'check-in')
  assert.equal(guessConversation('Retro', [], 'Management'), 'meeting')
})

test('the 1-1 tag still wins over the folder', () => {
  assert.equal(guessConversation('2026-03-02 1-1', ['tag-one-to-one'], 'Manager möte'), 'one-to-one')
})

test('a point is kept only when its quote is in the transcript', () => {
  const transcript = '03:10 Them: Jag tar det med ledningen, och återkommer på fredag.\n03:20 Jag: Bra.'
  const kept = keepQuoted(
    [
      // Punctuation and case differ, the words do not.
      { verdict: 'good', point: 'Lovade svar.', quote: 'jag tar det med ledningen och återkommer på fredag' },
      // Plausible, and never said.
      { verdict: 'less good', point: 'Sköt upp beslutet.', quote: 'vi får se längre fram' },
      // Part of a word is not a quote of it.
      { verdict: 'good', point: 'Kort.', quote: 'ledning' },
      { verdict: 'good', point: 'Tomt.', quote: '   ' }
    ],
    transcript
  )
  assert.deepEqual(
    kept.map((point) => point.point),
    ['Lovade svar.']
  )
})

/* What the summary reads: every line says whose it is. */
const LABELLED = [
  '04:01 Kim: Om du uppfyller kraven så är rollen din.',
  '04:05 Kim: Det viktigaste är att du kan lära dig den.',
  '04:09 Jag: Jag har bara hört rykten om omorganisationen.',
  '04:12 Kim: Vi får se.'
].join('\n')
const SPEAKERS = { labels: ['Jag', 'Kim', '?'], user: 'Jag' }

test('a quote may run across lines and elide with an ellipsis', () => {
  // How the model actually quoted on the first real run, and every one of
  // those was dropped by an exact match.
  const kept = keepQuoted(
    [{ verdict: 'good', point: 'Tydlig.', quote: 'Om du uppfyller kraven... det viktigaste är att du kan lära dig den' }],
    LABELLED,
    SPEAKERS
  )
  assert.equal(kept.length, 1)
})

test("the user's own words are not a quote of the other person", () => {
  const kept = keepQuoted(
    [{ verdict: 'less good', point: 'Vag.', quote: 'jag har bara hört rykten om omorganisationen' }],
    LABELLED,
    SPEAKERS
  )
  assert.equal(kept.length, 0)
})

test('pieces of a quote must come in the order they were said', () => {
  const kept = keepQuoted(
    [{ verdict: 'good', point: 'Bakvänt.', quote: 'det viktigaste är att du kan lära dig den... om du uppfyller kraven' }],
    LABELLED,
    SPEAKERS
  )
  assert.equal(kept.length, 0)
})

test('a word spelled differently still matches, words never said do not', () => {
  // From the first real 1-1: the speaker said "ha", the model wrote "har".
  const said = '05:10 Kim: Men jag ha fixat grejer liksom för att kunna göra det.'
  const point = (quote) => ({ verdict: 'good', point: 'P.', quote })
  assert.equal(keepQuoted([point('Men jag har fixat grejer liksom för att kunna göra det')], said, SPEAKERS).length, 1)
  // Half the words are there, which is a paraphrase wearing quotation marks.
  assert.equal(keepQuoted([point('Men jag har ordnat allt som behövs för att börja söka')], said, SPEAKERS).length, 0)
})

test('the speakers come from the channel names, or from a voice named Jag', () => {
  assert.deepEqual(quotedSpeakers({ speakers: { mine: 'Jag', theirs: 'Kim' } }), {
    labels: ['Jag', 'Kim', '?'],
    user: 'Jag'
  })
  assert.deepEqual(quotedSpeakers({ voices: ['Speaker 1', 'jag'] }), {
    labels: ['Speaker 1', 'jag', '?'],
    user: 'jag'
  })
  assert.equal('user' in quotedSpeakers({ voices: ['Speaker 1', 'Speaker 2'] }), false)
})

const MEETING = { kind: 'meeting', transcript: '00:01 Hej.', notes: '', language: 'sv', model: 'm' }

test('the instruction asks for it only where the schema has it, and says empty is normal', () => {
  const asked = instruction({ ...MEETING, conversation: 'manager' })
  assert.ok(asked.includes('In `theirs`'))
  assert.ok(asked.includes('the list is empty'))
  assert.equal(instruction({ ...MEETING, conversation: 'check-in' }).includes('In `theirs`'), false)
})

const VALUE = { summary: 'S.', decisions: [], actions: [], questions: [], people: [] }
const PROVENANCE = { model: 'm', costUsd: null }

test('the section shows each point with the words it rests on', () => {
  const html = summaryHtml(PROVENANCE, {
    ...VALUE,
    theirs: [
      { verdict: 'less good', point: 'Lämnade frågan öppen.', quote: 'vi tar det sen' },
      { verdict: 'good', point: 'Gav ett tydligt svar.', quote: 'det är beslutat' }
    ]
  })
  assert.ok(html.includes('<h2>Den andra partens bidrag</h2>'))
  // Good first, whatever order the model wrote them in.
  assert.ok(html.indexOf('<strong>Bra:</strong>') < html.indexOf('<strong>Mindre bra:</strong>'))
  assert.ok(html.includes('<em>"vi tar det sen"</em>'))
})

test('nothing that stood out means no heading at all', () => {
  assert.equal(summaryHtml(PROVENANCE, { ...VALUE, theirs: [] }).includes('Den andra partens'), false)
  assert.equal(summaryHtml(PROVENANCE, VALUE).includes('Den andra partens'), false)
})
