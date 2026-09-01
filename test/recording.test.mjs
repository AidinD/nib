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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { wavChannels } from 'keel/whisper'
import {
  findCallEnd,
  startRecording,
  stopRecording,
  trimRecording
} from '../src/main/recordings.ts'

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

/*
 * Where a recording stopped being the meeting it is filed as.
 *
 * These are written against built files rather than against the real one that
 * prompted the feature, for the reason the whole project keeps relearning: a
 * meeting is somebody's private conversation and does not belong in a fixture.
 * The real file was measured once, by hand, and the numbers it produced are
 * written into the test that matters - the stray-sample one - so the thing that
 * actually broke the first attempt cannot come back unnoticed.
 */

/**
 * A WAV assembled out of stretches, so a test can say what a file IS.
 *
 * `loud` is ordinary speech level, `dead` is a stream delivering nothing, and
 * `nearly` is what the real dead stretch turned out to look like: silence with
 * the occasional stray sample in it, which is what broke looking for exact zeros.
 */
function built(dir, name, channels, parts) {
  const rate = 16000
  const frames = parts.reduce((total, [, seconds]) => total + seconds * rate, 0)
  const body = Buffer.alloc(frames * channels * 2)
  let at = 0
  for (const [kind, seconds] of parts) {
    for (let frame = 0; frame < seconds * rate; frame++) {
      for (let channel = 0; channel < channels; channel++) {
        const value =
          kind === 'loud'
            ? Math.round(8000 * Math.sin((at + frame) / 12))
            : kind === 'nearly' && (at + frame) % 40000 === 0
              ? 224
              : 0
        body.writeInt16LE(value, ((at + frame) * channels + channel) * 2)
      }
    }
    at += seconds * rate
  }

  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + body.length, 4)
  head.write('WAVE', 8)
  head.write('fmt ', 12)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(channels, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE((rate * channels * 16) / 8, 28)
  head.writeUInt16LE((channels * 16) / 8, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(body.length, 40)

  const path = join(dir, name)
  writeFileSync(path, Buffer.concat([head, body]))
  return path
}

function scratch() {
  return mkdtempSync(join(tmpdir(), 'nib-call-'))
}

test('a call that dropped, with another conversation after it', async () => {
  const dir = scratch()
  try {
    // The shape of the meeting that prompted this: fourteen minutes, the call
    // drops, then several minutes of something else entirely.
    const path = built(dir, 'a.wav', 2, [
      ['loud', 60],
      ['dead', 90],
      ['loud', 60]
    ])
    const found = await findCallEnd(path)
    assert.notEqual(found, null)
    assert.equal(found.endsAt, 60)
    assert.equal(found.silence, 90)
    assert.equal(found.tail, 60)
    assert.equal(found.seconds, 210)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a recording left running into an empty room', async () => {
  const dir = scratch()
  try {
    // The other half of the same mistake, and the more likely one: nobody comes
    // back, so there is no tail at all - only the file going on without them.
    const path = built(dir, 'b.wav', 2, [
      ['loud', 45],
      ['dead', 120]
    ])
    const found = await findCallEnd(path)
    assert.notEqual(found, null)
    assert.equal(found.endsAt, 45)
    assert.equal(found.tail, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stray samples in the dead stretch do not break the run', async () => {
  const dir = scratch()
  try {
    /*
     * This is the one that matters. The first attempt looked for stretches of
     * exact zeros, and on the real recording the dead stretch was not exactly
     * zero throughout - single blocks carried a handful of samples peaking at
     * 224. That split an 83-second answer into pieces and moved the suggestion
     * 36 seconds past where the call actually ended.
     */
    const path = built(dir, 'c.wav', 2, [
      ['loud', 60],
      ['nearly', 90],
      ['loud', 60]
    ])
    const found = await findCallEnd(path)
    assert.notEqual(found, null)
    assert.equal(found.endsAt, 60, 'the stray samples must not start a new run')
    assert.equal(found.silence, 90)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a meeting that was stopped when it should have been says nothing', async () => {
  const dir = scratch()
  try {
    const path = built(dir, 'd.wav', 2, [['loud', 120]])
    assert.equal(await findCallEnd(path), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a pause in a conversation is not the end of one', async () => {
  const dir = scratch()
  try {
    // Ten seconds of nobody talking is a meeting, not a mistake. Offering to cut
    // a meeting in half because somebody was thinking is worse than not offering.
    const path = built(dir, 'e.wav', 2, [
      ['loud', 60],
      ['dead', 10],
      ['loud', 60]
    ])
    assert.equal(await findCallEnd(path), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the longest dead stretch wins, not the first', async () => {
  const dir = scratch()
  try {
    // Muting yourself for half a minute looks exactly like a call ending. Between
    // the two the longer one is the better guess: the mistake this exists for
    // leaves minutes behind, not seconds.
    const path = built(dir, 'f.wav', 2, [
      ['loud', 30],
      ['dead', 25],
      ['loud', 30],
      ['dead', 100],
      ['loud', 30]
    ])
    const found = await findCallEnd(path)
    assert.equal(found.endsAt, 85)
    assert.equal(found.silence, 100)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a recording that is silence from the start is not trimmed to nothing', async () => {
  const dir = scratch()
  try {
    // Throwing this away is a different control, and it is the person's to press.
    const path = built(dir, 'g.wav', 2, [
      ['dead', 120],
      ['loud', 30]
    ])
    assert.equal(await findCallEnd(path), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a mono recording is read the same way', async () => {
  const dir = scratch()
  try {
    const path = built(dir, 'h.wav', 1, [
      ['loud', 60],
      ['dead', 90]
    ])
    const found = await findCallEnd(path)
    assert.equal(found.endsAt, 60)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a file that is not there answers with nothing rather than throwing', async () => {
  assert.equal(await findCallEnd(join(tmpdir(), 'nib-no-such-recording.wav')), null)
})

test('trimming keeps the header honest about what is left', async () => {
  const dir = scratch()
  try {
    const path = built(dir, 'i.wav', 2, [
      ['loud', 60],
      ['dead', 90],
      ['loud', 60]
    ])
    const done = await trimRecording(path, 60)
    assert.equal(done.seconds, 60)

    const file = readFileSync(path)
    assert.equal(wavChannels(path), 2, 'the format must survive the cut')
    assert.equal(file.readUInt32LE(40), file.length - 44, 'data length against the file')
    assert.equal(file.readUInt32LE(4), file.length - 8, 'RIFF length against the file')
    assert.equal(file.readUInt32LE(24), 16000, 'sample rate untouched')
    // And the point of it: what came after the call is not in the file any more.
    assert.equal(await findCallEnd(path), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('trimming past the end of a recording leaves it alone', async () => {
  const dir = scratch()
  try {
    const path = built(dir, 'j.wav', 2, [['loud', 30]])
    const before = readFileSync(path).length
    const done = await trimRecording(path, 900)
    assert.equal(done.seconds, 30)
    assert.equal(readFileSync(path).length, before)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the recording being written to right now cannot be trimmed', async () => {
  const dir = scratch()
  try {
    const path = await startRecording(dir, 'note-live', 2)
    await assert.rejects(() => trimRecording(path, 5), /still running/)
  } finally {
    await stopRecording()
    rmSync(dir, { recursive: true, force: true })
  }
})
