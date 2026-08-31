/**
 * Tests for the file a meeting is written into.
 *
 * The header is the part that cannot be checked by looking at the app: a WAV
 * whose header disagrees with its contents still opens, still plays, and
 * transcribes as something - half speed, or one channel of noise - so getting it
 * wrong is invisible until somebody plays back a meeting they cannot repeat.
 *
 * Two channels is what makes the transcript able to say who spoke, and the
 * channel count is what whisper reads to decide whether to try. So these guard a
 * number that three separate things now depend on agreeing about.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { wavChannels } from 'keel/whisper'
import { startRecording, stopRecording } from '../src/main/recordings.ts'

/** 16-bit samples, interleaved the way the recorder sends them. */
function frames(count, channels) {
  const buffer = Buffer.alloc(count * channels * 2)
  for (let i = 0; i < count * channels; i++) {
    buffer.writeInt16LE(i % 1000, i * 2)
  }
  return new Uint8Array(buffer)
}

async function record(channels, seconds) {
  const dir = mkdtempSync(join(tmpdir(), 'nib-rec-'))
  const { appendSamples } = await import('../src/main/recordings.ts')
  const path = await startRecording(dir, 'note-abc', channels)
  appendSamples(frames(16000 * seconds, channels))
  const done = await stopRecording()
  return { dir, path, done }
}

test('a meeting is written as two channels', async () => {
  // Left is the microphone and right is the machine's own output. Whisper reads
  // the count off the header to decide whether it can label anything at all, so
  // a 1 here would silently turn the speaker labels off for every new recording.
  const { dir, done } = await record(2, 3)
  try {
    assert.equal(wavChannels(done.path), 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the length is in seconds of meeting, not in samples', async () => {
  // The trap this exists for: stereo doubles the bytes, so a length worked out
  // with the old mono divisor reports every meeting as twice as long as it was -
  // and the block in the note is the only place anybody would notice.
  const { dir, done } = await record(2, 3)
  try {
    assert.equal(done.seconds, 3)
    assert.equal(done.bytes, 16000 * 3 * 2 * 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the header agrees with itself about the byte rate', async () => {
  // Byte rate and block align are what a player uses to work out speed. A stereo
  // file carrying mono figures plays back at half speed, which sounds exactly
  // like a recording that went wrong rather than like a header that did.
  const { dir, done } = await record(2, 1)
  try {
    const header = readFileSync(done.path).subarray(0, 44)
    assert.equal(header.readUInt16LE(22), 2, 'channels')
    assert.equal(header.readUInt32LE(24), 16000, 'sample rate')
    assert.equal(header.readUInt32LE(28), 16000 * 2 * 2, 'byte rate')
    assert.equal(header.readUInt16LE(32), 4, 'block align')
    assert.equal(header.readUInt32LE(40), done.bytes, 'data length')
    assert.equal(header.readUInt32LE(4), 36 + done.bytes, 'RIFF length')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a mono recording still writes a correct mono file', async () => {
  // Nothing asks for one today. It is here because the channel count became a
  // parameter, and a parameter with one caller is a parameter nobody notices
  // breaking.
  const { dir, done } = await record(1, 2)
  try {
    assert.equal(wavChannels(done.path), 1)
    assert.equal(done.seconds, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('two meetings at once is refused rather than interleaved', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nib-rec-'))
  try {
    await startRecording(dir, 'note-one', 2)
    await assert.rejects(() => startRecording(dir, 'note-two', 2), /Already recording/)
  } finally {
    await stopRecording()
    rmSync(dir, { recursive: true, force: true })
  }
})
