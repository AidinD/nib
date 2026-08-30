import { createWriteStream, WriteStream } from 'fs'
import { promises as fs } from 'fs'
import { join } from 'path'

/*
 * Writing a meeting to disk, while it is still happening.
 *
 * The renderer sends 16-bit mono samples as they are captured and this appends
 * them to a WAV file straight away. Nothing is buffered until the end: a meeting
 * is forty-five minutes of work that cannot be repeated, and a crash at minute
 * forty must cost the last second rather than the whole thing.
 *
 * WAV rather than a compressed format because whisper reads it directly. The
 * cost is size - 16 kHz mono is about 1.9 MB a minute, so a long meeting is under
 * a hundred megabytes - and the file is deleted once its transcript exists.
 */

/** 16 kHz mono is what whisper.cpp resamples everything to anyway. */
const SAMPLE_RATE = 16000
const CHANNELS = 1
const BITS = 16

/** A 44-byte WAV header with the two lengths left at zero until the file closes. */
function header(dataBytes: number): Buffer {
  const buffer = Buffer.alloc(44)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // PCM header length
  buffer.writeUInt16LE(1, 20) // PCM, uncompressed
  buffer.writeUInt16LE(CHANNELS, 22)
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE((SAMPLE_RATE * CHANNELS * BITS) / 8, 28) // byte rate
  buffer.writeUInt16LE((CHANNELS * BITS) / 8, 32) // block align
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
export async function startRecording(recordingsDir: string, noteId: string): Promise<string> {
  if (current !== null) {
    throw new Error('Already recording')
  }
  await fs.mkdir(recordingsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const path = join(recordingsDir, `${noteId}-${stamp}.wav`)

  const stream = createWriteStream(path)
  stream.write(header(0))
  current = { path, stream, bytes: 0, started: Date.now() }
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
    await handle.write(header(recording.bytes), 0, 44, 0)
  } finally {
    await handle.close()
  }

  return {
    path: recording.path,
    bytes: recording.bytes,
    seconds: Math.round(recording.bytes / ((SAMPLE_RATE * CHANNELS * BITS) / 8))
  }
}

/**
 * Remove recordings whose note is gone.
 *
 * A recording is temporary by design - deleted the moment its words are in the
 * note - but the two ways that does not happen are ordinary: the transcription
 * was never asked for, or the note was thrown away with the audio still attached.
 * The second leaves a file nothing can ever point at again, and 1.9MB a minute
 * adds up quietly in a folder nobody opens.
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
