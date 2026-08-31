/**
 * Tests for what a transcript says about who was talking.
 *
 * The rule being guarded: the label is printed on the TURN, not on the line. A
 * name in front of all four hundred lines of a meeting is a column of noise, and
 * the reason the feature exists is to make a transcript easier to read rather
 * than harder. The second rule is that whisper's `?` survives - it means the two
 * channels were level, and replacing it with a name would be a guess wearing
 * somebody's name.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { clock, transcriptHtml } from '../src/renderer/src/lib/notes.ts'

const NAMES = { mine: 'Jag', theirs: 'Motparten' }

/** `speaker` omitted entirely is what a mono recording produces. */
const MONO = [
  { start: '00:00:00', end: '00:00:02', text: 'Hej.' },
  { start: '00:00:02', end: '00:00:05', text: 'Hej hej.' }
]

const STEREO = [
  { start: '00:00:00', end: '00:00:02', text: 'Hej.', speaker: '0' },
  { start: '00:00:02', end: '00:00:05', text: 'Och en sak till.', speaker: '0' },
  { start: '00:00:05', end: '00:00:08', text: 'Absolut.', speaker: '1' },
  { start: '00:00:08', end: '00:00:11', text: 'Jag fixar det.', speaker: '0' }
]

test('a mono recording is transcribed exactly as it always was', () => {
  // Every note made before this is a mono file, and re-transcribing one must not
  // start claiming it knows who spoke.
  const html = transcriptHtml(MONO, 1, NAMES)
  assert.equal(html.includes('data-speaker'), false)
  assert.ok(html.includes('Hej hej.'))
})

test('the name is printed when the speaker changes, not on every line', () => {
  const html = transcriptHtml(STEREO, 1, NAMES)
  // Four segments, three turns.
  assert.equal((html.match(/data-speaker=/g) ?? []).length, 3)
  assert.equal((html.match(/>Jag</g) ?? []).length, 2)
  assert.equal((html.match(/>Motparten</g) ?? []).length, 1)
})

test('the microphone is the user and the other channel is the other side', () => {
  // Load-bearing, and the one thing here that silently inverts: speaker 0 is the
  // left channel, and the recorder puts the microphone there.
  const html = transcriptHtml(STEREO, 1, NAMES)
  assert.ok(html.includes('<span data-speaker="mine">Jag</span>'))
  assert.ok(html.includes('<span data-speaker="theirs">Motparten</span>'))
})

test("whisper's own doubt is kept rather than resolved into a name", () => {
  const html = transcriptHtml(
    [
      { start: '00:00:00', end: '00:00:02', text: 'Ett.', speaker: '0' },
      { start: '00:00:02', end: '00:00:04', text: 'Tva.', speaker: '?' }
    ],
    1,
    NAMES
  )
  assert.ok(html.includes('<span data-speaker="unknown">?</span>'))
  assert.equal(html.includes('unknown">Jag'), false)
})

test('no names means no labels, whatever the segments carry', () => {
  // The renderer only knows the names when the note is open. A transcript built
  // without them must come out as plain lines rather than as `undefined`.
  const html = transcriptHtml(STEREO, 1)
  assert.equal(html.includes('data-speaker'), false)
  assert.equal(html.includes('undefined'), false)
})

test('a name is escaped like any other text in the note', () => {
  const html = transcriptHtml(STEREO, 1, { mine: 'Jag', theirs: '<b>Motparten' })
  assert.equal(html.includes('<b>Motparten'), false)
  assert.ok(html.includes('&lt;b&gt;Motparten'))
})

test('a moment reads as a position in the meeting, not as a duration', () => {
  // `0:07` and not `00:07`: it is answering "how far in", which is how anybody
  // refers to a recording out loud.
  assert.equal(clock(7), '0:07')
  assert.equal(clock(72), '1:12')
  assert.equal(clock(3671), '1:01:11')
  assert.equal(clock(-5), '0:00')
})
