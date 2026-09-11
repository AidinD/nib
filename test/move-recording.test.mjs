/**
 * Giving a recording to another note, and the filename that decides who owns it.
 *
 * The dangerous half is not the markup. A recording's FILENAME is the only
 * record of which note it belongs to: the startup sweep reads the note id out of
 * it and deletes anything it no longer recognises, and deleting a note schedules
 * exactly that sweep. Move a block to another note without renaming the file and
 * the audio keeps playing - right up until the note it was recorded in is
 * deleted, at which point the sweep takes the file out from under a note that is
 * still using it. That is the failure these tests exist for.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { moveRecording, sweepRecordings } from '../src/main/recordings.ts'

/** A scratch recordings folder, never the real one. */
function scratch() {
  return mkdtempSync(join(tmpdir(), 'nib-move-'))
}

/*
 * Exactly what `startRecording` writes: ISO with the colons and dots swapped for
 * hyphens and then cut to 19 characters, so there is no fractional part and no
 * trailing Z. A fixture that invents a longer stamp passes nothing - the first
 * version of this file used one, and every rename came back null because the
 * sweep's own pattern did not recognise it either.
 */
const STAMP = '2026-09-11T09-15-00'

test('the file is renamed to the note it now belongs to', async () => {
  const dir = scratch()
  try {
    const from = join(dir, `note-aaa-${STAMP}.wav`)
    writeFileSync(from, 'RIFF')
    const to = await moveRecording(dir, from, 'note-bbb')
    assert.equal(to, join(dir, `note-bbb-${STAMP}.wav`))
    assert.equal(existsSync(from), false, 'the old name is gone, not copied')
    assert.equal(existsSync(to), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('and the sweep now protects it under its new owner', async () => {
  /*
   * The whole point, end to end: the note it was recorded in is deleted, the
   * sweep runs with only the new note alive, and the audio survives.
   */
  const dir = scratch()
  try {
    const from = join(dir, `note-aaa-${STAMP}.wav`)
    writeFileSync(from, 'RIFF')
    const to = await moveRecording(dir, from, 'note-bbb')
    const swept = await sweepRecordings(dir, new Set(['note-bbb']))
    assert.equal(swept.removed, 0, 'nothing was an orphan')
    assert.equal(existsSync(to), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('without the rename the sweep would have taken it - which is why it renames', async () => {
  // Not a test of the move: a test of the danger, so the reason the rename
  // exists cannot quietly stop being true.
  const dir = scratch()
  try {
    const stranded = join(dir, `note-aaa-${STAMP}.wav`)
    writeFileSync(stranded, 'RIFF')
    const swept = await sweepRecordings(dir, new Set(['note-bbb']))
    assert.equal(swept.removed, 1)
    assert.equal(existsSync(stranded), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a note id with hyphens of its own survives the round trip', async () => {
  // The id is what is LEFT after the timestamp comes off the end, never
  // something split off the front - the same rule the sweep uses.
  const dir = scratch()
  try {
    const from = join(dir, `note-aa-bb-cc-${STAMP}.wav`)
    writeFileSync(from, 'RIFF')
    const to = await moveRecording(dir, from, 'note-dd-ee-ff')
    assert.equal(to, join(dir, `note-dd-ee-ff-${STAMP}.wav`))
    const swept = await sweepRecordings(dir, new Set(['note-dd-ee-ff']))
    assert.equal(swept.removed, 0, 'the sweep reads back exactly what was written')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a recording whose audio is already gone is not a failure', async () => {
  // An ordinary state: the block is still worth moving, it just has no file.
  const dir = scratch()
  try {
    assert.equal(await moveRecording(dir, join(dir, `note-aaa-${STAMP}.wav`), 'note-bbb'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('nothing outside the recordings folder can be renamed', async () => {
  /*
   * The path arrives from the renderer, off an attribute in a note's HTML, and
   * a note's HTML is the least trustworthy thing in this app - it round-trips
   * through a sanitiser and can be edited by hand.
   */
  const dir = scratch()
  const elsewhere = scratch()
  try {
    const outside = join(elsewhere, `note-aaa-${STAMP}.wav`)
    writeFileSync(outside, 'RIFF')
    assert.equal(await moveRecording(dir, outside, 'note-bbb'), null)
    assert.equal(existsSync(outside), true, 'and it is still there')
    assert.deepEqual(readdirSync(dir), [], 'nothing arrived in the recordings folder')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(elsewhere, { recursive: true, force: true })
  }
})

test('a file that is not a recording is left alone', async () => {
  const dir = scratch()
  try {
    const odd = join(dir, 'notes.txt')
    writeFileSync(odd, 'hello')
    assert.equal(await moveRecording(dir, odd, 'note-bbb'), null)
    assert.equal(existsSync(odd), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('moving it to the note it is already in changes nothing', async () => {
  const dir = scratch()
  try {
    const from = join(dir, `note-aaa-${STAMP}.wav`)
    writeFileSync(from, 'RIFF')
    assert.equal(await moveRecording(dir, from, 'note-aaa'), from)
    assert.equal(existsSync(from), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
