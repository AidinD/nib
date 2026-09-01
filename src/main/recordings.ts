import { createWriteStream, WriteStream } from 'fs'
import { promises as fs } from 'fs'
import type { FileHandle } from 'fs/promises'
import { join } from 'path'

/*
 * Writing a meeting to disk, while it is still happening.
 *
 * The renderer sends 16-bit samples as they are captured and this appends them
 * to a WAV file straight away. Nothing is buffered until the end: a meeting is
 * forty-five minutes of work that cannot be repeated, and a crash at minute
 * forty must cost the last second rather than the whole thing.
 *
 * WAV rather than a compressed format because whisper reads it directly. The
 * cost is size - 16 kHz stereo is about 3.8 MB a minute, so a long meeting is a
 * couple of hundred megabytes - and the audio is kept until it is discarded on
 * purpose.
 *
 * ## Two channels, because one cannot say who spoke
 *
 * The microphone goes left and the machine's own output goes right - see
 * recorder.ts - which is what lets whisper label the transcript by speaker
 * without any voice recognition at all. The channel count is carried on the
 * recording rather than fixed here, so the header, the byte rate and the length
 * cannot disagree with what is actually being written, and so a mono file made
 * before this still reads back correctly.
 */

/** 16 kHz is what whisper.cpp resamples everything to anyway. */
const SAMPLE_RATE = 16000
const BITS = 16

/** A 44-byte WAV header with the two lengths left at zero until the file closes. */
function header(dataBytes: number, channels: number): Buffer {
  const buffer = Buffer.alloc(44)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // PCM header length
  buffer.writeUInt16LE(1, 20) // PCM, uncompressed
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE((SAMPLE_RATE * channels * BITS) / 8, 28) // byte rate
  buffer.writeUInt16LE((channels * BITS) / 8, 32) // block align
  buffer.writeUInt16LE(BITS, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  return buffer
}

interface Recording {
  path: string
  stream: WriteStream
  bytes: number
  started: number
  channels: number
}

/** One at a time, deliberately: two meetings at once is a mistake, not a feature. */
let current: Recording | null = null

export function isRecording(): boolean {
  return current !== null
}

/**
 * Open a file and write the header.
 *
 * Named after the note it belongs to and the moment it started, so an orphan left
 * by a crash says which meeting it was and when - a folder of `rec-1.wav` tells
 * you nothing when you find it a week later.
 */
export async function startRecording(
  recordingsDir: string,
  noteId: string,
  channels = 2
): Promise<string> {
  if (current !== null) {
    throw new Error('Already recording')
  }
  await fs.mkdir(recordingsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const path = join(recordingsDir, `${noteId}-${stamp}.wav`)

  const stream = createWriteStream(path)
  stream.write(header(0, channels))
  current = { path, stream, bytes: 0, started: Date.now(), channels }
  return path
}

/** Append captured samples. Silently ignored when nothing is recording, because
 *  a chunk in flight when Stop was pressed is normal, not an error. */
export function appendSamples(chunk: Uint8Array): void {
  if (current === null) {
    return
  }
  current.stream.write(Buffer.from(chunk))
  current.bytes += chunk.byteLength
}

/**
 * Close the file and patch the two lengths the header could not know.
 *
 * A WAV whose header still says zero bytes plays as an empty file and transcribes
 * as silence, so this has to happen even when the app is closing - see the
 * `before-quit` handler.
 */
export async function stopRecording(): Promise<{ path: string; seconds: number; bytes: number } | null> {
  const recording = current
  if (recording === null) {
    return null
  }
  current = null

  await new Promise<void>((resolve) => recording.stream.end(resolve))
  const handle = await fs.open(recording.path, 'r+')
  try {
    await handle.write(header(recording.bytes, recording.channels), 0, 44, 0)
  } finally {
    await handle.close()
  }

  return {
    path: recording.path,
    bytes: recording.bytes,
    seconds: Math.round(
      recording.bytes / ((SAMPLE_RATE * recording.channels * BITS) / 8)
    )
  }
}

/**
 * Remove recordings whose note is gone.
 *
 * A recording outlives its transcript by design - it is discarded from the block
 * on purpose, once the words have been read - so the file nothing can ever point
 * at again is the one whose note was deleted with the audio still attached. The
 * control that would have thrown it away went with the note. 3.8MB a minute adds
 * up quietly in a folder nobody opens.
 *
 * Only orphans. A recording whose note still exists might be transcribed
 * tomorrow, and deleting somebody's meeting because they have not got round to it
 * is not a housekeeping decision an app gets to make.
 *
 * @param recordingsDir Where the files are.
 * @param liveNoteIds   Every note id the index still knows about.
 */
export async function sweepRecordings(
  recordingsDir: string,
  liveNoteIds: Set<string>
): Promise<{ removed: number; bytes: number }> {
  let removed = 0
  let bytes = 0
  let names: string[]
  try {
    names = await fs.readdir(recordingsDir)
  } catch {
    return { removed, bytes }
  }

  for (const name of names) {
    if (!name.endsWith('.wav')) {
      continue
    }
    // `<noteId>-<timestamp>.wav`, and a note id has its own hyphens - so the
    // timestamp is peeled off the end rather than the id split off the front.
    const noteId = name.replace(/-\d{4}-\d{2}-\d{2}T[\d-]+\.wav$/, '')
    if (noteId === name || liveNoteIds.has(noteId)) {
      continue
    }
    const path = join(recordingsDir, name)
    try {
      const stats = await fs.stat(path)
      await fs.rm(path, { force: true })
      removed += 1
      bytes += stats.size
    } catch {
      // A file that cannot be removed is not worth failing a launch over.
    }
  }
  return { removed, bytes }
}

/** Delete a recording once its transcript exists - the whole point of keeping it. */
export async function deleteRecording(path: string): Promise<void> {
  await fs.rm(path, { force: true })
}

/*
 * ## Finding where the call actually ended
 *
 * Forgetting to press Stop is not an unusual mistake, it is the ordinary one:
 * the call ends, the window closes, and the recording keeps writing whatever the
 * room and the machine do next. Twice now out of two real meetings. What lands
 * in the note afterwards is not a longer meeting, it is a different conversation
 * filed under the wrong heading - and then read by the summary as if it belonged.
 *
 * The file knows when it happened. When a call drops, the microphone stream and
 * the machine's output stream stop delivering at the same instant, and what gets
 * written is not a quiet room - it is nothing at all. A live capture never does
 * that: a real microphone in a real room has a floor, and on the recording that
 * prompted this the meeting never fell below a peak of a few thousand while the
 * dead stretch never rose above 312.
 *
 * So the signal is a stretch where EVERY channel is under `DEAD_PEAK` for at
 * least `MIN_SILENCE`. That covers both shapes of the mistake with one idea: the
 * call that dropped and was followed by other talk, and the recording left
 * running into an empty room until somebody noticed.
 *
 * Near-silence rather than exact zeros, which was the first attempt and is
 * wrong. On the real file the dead stretch was not strictly zero throughout -
 * single blocks carried a handful of samples peaking at 224, enough to break a
 * run into pieces and move the answer 36 seconds past the truth. Blocks of
 * 100 ms with a peak threshold survive that and still cannot be tripped by
 * anybody being quiet.
 *
 * It is a suggestion, never an act. The one thing here that cannot be recorded
 * again does not get shortened because a heuristic was confident.
 */

/** Peak below this, on every channel, is nothing being there at all. About -36 dBFS. */
const DEAD_PEAK = 512
/** Short enough to find the seam, long enough that one stray sample cannot break a run. */
const DEAD_BLOCK_MS = 100
/** Anything shorter is a pause in a conversation, not the end of one. */
const MIN_SILENCE = 20
/** Below this there is nothing worth offering to cut. */
const MIN_SAVING = 20
/** Trimming to less than this is discarding the recording, which is a different control. */
const MIN_KEEP = 5

/** Where a recording stopped being the meeting it is filed as. */
export interface CallEnd {
  /** Where to cut: the second the audio went dead. */
  endsAt: number
  /** How long it stayed dead. */
  silence: number
  /** Audio after the dead stretch - zero when the file simply ran out. */
  tail: number
  /** The whole file, so a caller can say what the cut would save. */
  seconds: number
}

/** The 44-byte header Nib writes, read back. Null when it is not that shape. */
async function readHeader(
  handle: FileHandle
): Promise<{ channels: number; rate: number; frameBytes: number; frames: number } | null> {
  const head = Buffer.alloc(44)
  const { bytesRead } = await handle.read(head, 0, 44, 0)
  if (
    bytesRead < 44 ||
    head.toString('latin1', 0, 4) !== 'RIFF' ||
    head.toString('latin1', 8, 12) !== 'WAVE'
  ) {
    return null
  }
  const channels = head.readUInt16LE(22)
  const rate = head.readUInt32LE(24)
  const bits = head.readUInt16LE(34)
  if (channels < 1 || channels > 2 || rate < 1 || bits !== BITS) {
    return null
  }
  const frameBytes = (channels * BITS) / 8
  const { size } = await handle.stat()
  return { channels, rate, frameBytes, frames: Math.max(0, Math.floor((size - 44) / frameBytes)) }
}

/**
 * Look for the moment the call ended, somewhere before the file did.
 *
 * Answers with the LONGEST dead stretch rather than the first. Muting yourself
 * for half a minute mid-meeting produces the same shape as a call ending, and
 * between the two the longer one is the better guess - the mistake this exists
 * for leaves minutes behind, not seconds.
 *
 * Null when there is nothing to say, which is the common case: a recording
 * stopped when it should have been is not interesting.
 */
export async function findCallEnd(path: string): Promise<CallEnd | null> {
  let handle: FileHandle
  try {
    handle = await fs.open(path, 'r')
  } catch {
    return null
  }
  try {
    const wav = await readHeader(handle)
    if (wav === null || wav.frames === 0) {
      return null
    }
    const { channels, rate, frameBytes, frames } = wav
    const blockFrames = Math.max(1, Math.round((rate * DEAD_BLOCK_MS) / 1000))
    // Read in megabyte-ish chunks, whole blocks at a time, so a two-hundred
    // megabyte meeting is a sequential scan rather than ten thousand reads.
    const chunkBlocks = Math.max(1, Math.floor(1000000 / (blockFrames * frameBytes)))
    const buffer = Buffer.alloc(chunkBlocks * blockFrames * frameBytes)

    let deadFrom: number | null = null
    let bestFrom = 0
    let bestLength = 0
    let frame = 0

    const closeRun = (until: number): void => {
      if (deadFrom !== null && until - deadFrom > bestLength) {
        bestLength = until - deadFrom
        bestFrom = deadFrom
      }
      deadFrom = null
    }

    while (frame < frames) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, (frames - frame) * frameBytes),
        44 + frame * frameBytes
      )
      if (bytesRead < frameBytes) {
        break
      }
      const readFrames = Math.floor(bytesRead / frameBytes)
      for (let start = 0; start < readFrames; start += blockFrames) {
        const end = Math.min(start + blockFrames, readFrames)
        let peak = 0
        for (let at = start * channels; at < end * channels; at += 1) {
          const value = Math.abs(buffer.readInt16LE(at * 2))
          if (value > peak) {
            peak = value
          }
        }
        if (peak < DEAD_PEAK) {
          if (deadFrom === null) {
            deadFrom = frame + start
          }
        } else {
          closeRun(frame + start)
        }
      }
      frame += readFrames
    }
    closeRun(frames)

    const seconds = frames / rate
    const endsAt = Math.floor(bestFrom / rate)
    const silence = bestLength / rate
    if (silence < MIN_SILENCE || endsAt < MIN_KEEP || seconds - endsAt < MIN_SAVING) {
      return null
    }
    return {
      endsAt,
      silence: Math.round(silence),
      tail: Math.max(0, Math.round(seconds - (bestFrom + bestLength) / rate)),
      seconds: Math.round(seconds)
    }
  } catch {
    // A file that cannot be read is not a recording with a problem worth
    // reporting - transcription will say so far more clearly.
    return null
  } finally {
    await handle.close()
  }
}

/**
 * Shorten a recording to its first `seconds`, in place.
 *
 * The header is patched BEFORE the file is truncated, and only its two length
 * fields are touched. Both details matter. Rewriting the whole header would put
 * this module's idea of the sample rate over the file's own, which is fine until
 * the day it is not; and truncating first would leave a crash in between holding
 * a file whose header promises audio that is no longer there. In this order the
 * worst a crash can leave behind is a correct header with unreferenced bytes
 * after it, which every reader of a WAV ignores.
 *
 * There is no undo. The caller asks first - see the trim control on the block.
 */
export async function trimRecording(
  path: string,
  seconds: number
): Promise<{ seconds: number; bytes: number }> {
  if (current !== null && current.path === path) {
    throw new Error('That recording is still running')
  }
  const handle = await fs.open(path, 'r+')
  try {
    const wav = await readHeader(handle)
    if (wav === null) {
      throw new Error('That file is not a recording this can shorten')
    }
    const keepFrames = Math.min(wav.frames, Math.max(0, Math.round(seconds * wav.rate)))
    const keepBytes = keepFrames * wav.frameBytes
    const patch = Buffer.alloc(4)
    patch.writeUInt32LE(36 + keepBytes, 0)
    await handle.write(patch, 0, 4, 4)
    patch.writeUInt32LE(keepBytes, 0)
    await handle.write(patch, 0, 4, 40)
    await handle.truncate(44 + keepBytes)
    return { seconds: Math.round(keepFrames / wav.rate), bytes: keepBytes }
  } finally {
    await handle.close()
  }
}
