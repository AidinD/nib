/**
 * Which notes are holding audio, answered by listing one directory.
 *
 * No note is opened. A recording's filename carries the id of the note that owns
 * it - the same fact the sweep reads, and the same fact `moveRecording` keeps
 * true - so the folder already knows. That is what makes this cheap enough to
 * ask on every launch of a notebook of any size.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { audioByNote, moveRecording } from '../src/main/recordings.ts'

function scratch() {
  return mkdtempSync(join(tmpdir(), 'nib-audio-'))
}

/** `startRecording`'s own shape: ISO, hyphenated, cut to 19 characters. */
const wav = (noteId, stamp) => `${noteId}-${stamp}.wav`

test('one recording, under the note that owns it', async () => {
  const dir = scratch()
  try {
    writeFileSync(join(dir, wav('note-aaa', '2026-09-11T09-15-00')), Buffer.alloc(2_000_000))
    const rows = await audioByNote(dir)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].noteId, 'note-aaa')
    assert.equal(rows[0].bytes, 2_000_000)
    assert.deepEqual(rows[0].paths, [join(dir, wav('note-aaa', '2026-09-11T09-15-00'))])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('two recordings in one note are one row, added up', async () => {
  // A meeting stopped and restarted, or two calls in an afternoon. One card to
  // act on, so one row - a list saying two would send you looking for a second
  // note that does not exist.
  const dir = scratch()
  try {
    writeFileSync(join(dir, wav('note-aaa', '2026-09-11T09-15-00')), Buffer.alloc(1_000_000))
    writeFileSync(join(dir, wav('note-aaa', '2026-09-11T10-20-00')), Buffer.alloc(3_000_000))
    const rows = await audioByNote(dir)
    assert.equal(rows.length, 1, 'one row')
    assert.equal(rows[0].bytes, 4_000_000, 'added up')
    assert.equal(rows[0].paths.length, 2, 'and both files named, because both get deleted')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a note id with hyphens of its own is read back whole', async () => {
  const dir = scratch()
  try {
    writeFileSync(join(dir, wav('note-aa-bb-cc', '2026-09-11T09-15-00')), Buffer.alloc(500_000))
    const rows = await audioByNote(dir)
    assert.equal(rows[0].noteId, 'note-aa-bb-cc')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a moved recording is counted under its new note, not its old one', async () => {
  /*
   * The reason the rename exists, seen from the other end: the folder is the
   * record of ownership, so moving a recording has to move what this reports or
   * the housekeeping list points at the wrong card.
   */
  const dir = scratch()
  try {
    const from = join(dir, wav('note-wrong', '2026-09-11T09-15-00'))
    writeFileSync(from, Buffer.alloc(1_500_000))
    await moveRecording(dir, from, 'note-right')
    const rows = await audioByNote(dir)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].noteId, 'note-right')
    assert.equal(rows[0].bytes, 1_500_000)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('anything that is not a recording is ignored', async () => {
  const dir = scratch()
  try {
    writeFileSync(join(dir, 'notes.txt'), 'hello')
    writeFileSync(join(dir, 'note-aaa-2026-09-11T09-15-00.wav.uncut-backup'), Buffer.alloc(9))
    writeFileSync(join(dir, 'stray.wav'), Buffer.alloc(9))
    assert.deepEqual(await audioByNote(dir), [], 'no stamp, no owner, no row')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a folder that does not exist yet is simply empty', async () => {
  // The ordinary state of a notebook nobody has recorded in.
  assert.deepEqual(await audioByNote(join(tmpdir(), 'nib-audio-nothing-here')), [])
})
