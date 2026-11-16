/**
 * Tests for a transcript split by voice - a recording made on one microphone and
 * imported, rather than one of Nib's own two-channel recordings.
 *
 * Guarded: a voice is named on its turn and listed once on the summary line, so
 * it can be renamed from the folded block; a name given before survives a second
 * run; a recording whose voices could not be told apart says so instead of
 * looking like one speaker; the channel labels are untouched; and the summary is
 * told what the voice labels are and which of them is the user.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { transcriptHtml } from '../src/renderer/src/lib/notes.ts'
import { instruction } from '../src/main/summary.ts'
import { toMono16 } from '../src/renderer/src/lib/decode-audio.ts'

const VOICED = [
  { start: '00:00:00', end: '00:00:04', text: 'Välkomna.', voice: 1 },
  { start: '00:00:04', end: '00:00:06', text: 'Och en sak till.', voice: 1 },
  { start: '00:00:06', end: '00:00:09', text: 'Absolut.', voice: 2 },
  { start: '00:00:09', end: '00:00:11', text: 'Mm.' },
  { start: '00:00:11', end: '00:00:14', text: 'Jag tar det.', voice: 3 }
]

test('a voice is named on its turn, not on every line', () => {
  const html = transcriptHtml(VOICED, 1, undefined, { count: 3 })
  const body = html.slice(html.indexOf('</summary>'))
  assert.equal((body.match(/data-speaker="v1"/g) ?? []).length, 1)
  assert.ok(body.includes('<span data-speaker="v2">Speaker 2</span> Absolut.'))
  // A line no voice could be matched to is marked as doubt, not given a name.
  assert.ok(body.includes('<span data-speaker="unknown">?</span> Mm.'))
})

test('every voice is listed once on the summary line, where it can be renamed folded', () => {
  const html = transcriptHtml(VOICED, 1, undefined, { count: 3 })
  const summary = html.slice(html.indexOf('<summary>'), html.indexOf('</summary>'))
  for (const voice of ['v1', 'v2', 'v3']) {
    assert.equal((summary.match(new RegExp(`data-speaker="${voice}"`, 'g')) ?? []).length, 1)
  }
  assert.ok(summary.startsWith('<summary>Transkript · 1 min · 5 avsnitt'))
})

test('a name given before is carried over by voice number', () => {
  const html = transcriptHtml(VOICED, 1, undefined, { count: 3, names: { v2: 'Anna <A>' } })
  assert.ok(html.includes('<span data-speaker="v2">Anna &lt;A&gt;</span> Absolut.'))
  assert.ok(html.includes('<span data-speaker="v1">Speaker 1</span>'))
})

test('voices that could not be told apart are said to be so, with no labels', () => {
  const unlabelled = VOICED.map(({ voice: _voice, ...rest }) => rest)
  for (const count of [0, 1]) {
    const html = transcriptHtml(unlabelled, 1, undefined, { count })
    assert.equal(html.includes('data-speaker'), false)
    assert.ok(html.includes('talarna är inte särskilda'))
  }
})

test("Nib's own two-channel recordings are labelled exactly as before", () => {
  const stereo = [
    { start: '00:00:00', end: '00:00:02', text: 'Hej.', speaker: '0' },
    { start: '00:00:02', end: '00:00:05', text: 'Hej hej.', speaker: '1' }
  ]
  const before = transcriptHtml(stereo, 1, { mine: 'Jag', theirs: 'Dem' })
  assert.ok(before.includes('<span data-speaker="mine">Jag</span> Hej.'))
  assert.ok(before.includes('<summary>Transkript · 1 min · 2 avsnitt<span data-drop'))
})

const MEETING = { kind: 'meeting', transcript: '00:00 Speaker 1 Hej.', notes: '', language: 'sv', model: 'm' }

test('the summary is told the voices are clustered, and to trust the words over them', () => {
  const text = instruction({ ...MEETING, voices: ['Speaker 1', 'Anna'] })
  assert.ok(text.includes('"Speaker 1", "Anna"'))
  assert.ok(text.includes('clustering'))
  assert.ok(text.includes('None of the labels says which voice is the user'))
})

test('a voice named Jag is the user', () => {
  const text = instruction({ ...MEETING, voices: ['Jag', 'Anna'] })
  assert.ok(text.includes('The voice labelled "Jag" is the user.'))
})

test('no voices, no voice instruction', () => {
  assert.equal(instruction(MEETING).includes('split by voice'), false)
})

test('stereo is mixed down to one channel at 16 bits', () => {
  const left = new Float32Array([1, -1, 0.5, 0])
  const right = new Float32Array([1, -1, -0.5, 0.25])
  assert.deepEqual([...toMono16([left, right], 4)], [32767, -32768, 0, 4096])
})
