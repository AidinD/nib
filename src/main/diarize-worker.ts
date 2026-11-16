import { readFileSync } from 'fs'
import { createRequire } from 'module'

/*
 * Telling voices apart, in a process of its own.
 *
 * Started by `diarize.ts` as an Electron utility process. The work is a few
 * minutes of solid CPU for a long meeting, and sherpa-onnx does it in one
 * synchronous call - in the main process that call would freeze every window
 * for its whole length, and a crash in the native code would take the app down
 * with it. Here it can only take itself down, and the transcript is already in
 * the note by the time this starts.
 *
 * One request per process. The models are loaded, the file is read, the answer
 * goes back and the process exits: there is nothing worth keeping warm between
 * meetings, and a process that exits returns all of its memory.
 */

interface Request {
  file: string
  config: unknown
}

interface Turn {
  start: number
  end: number
  speaker: number
}

/*
 * Through `require` rather than `import`: the package is CommonJS with a native
 * addon behind it, and it ships no type declarations. Typed here, at the one
 * place it is used, as the three calls this file makes.
 */
const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as {
  OfflineSpeakerDiarization: new (config: unknown) => {
    sampleRate: number
    process: (samples: Float32Array) => Turn[]
  }
}

/*
 * The WAV is read here rather than with sherpa's own `readWave`.
 *
 * `readWave` hands back samples in memory the native side allocated, and
 * Electron refuses those - its V8 runs with a memory cage that will not accept
 * an "external" buffer, and the call throws "External buffers are not allowed".
 * Found on the first end-to-end run. Samples allocated here, in JavaScript, are
 * inside the cage, and sherpa reads them without complaint.
 *
 * Only the PCM WAV Nib writes itself is expected - 16-bit, one channel - but the
 * chunks are walked rather than assumed at 44 bytes, so a WAV with an extra
 * chunk still reads.
 */
function readWave(file: string): { samples: Float32Array; sampleRate: number } {
  const bytes = readFileSync(file)
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error('the recording is not a WAV file')
  }
  let at = 12
  let sampleRate = 0
  let channels = 0
  let bits = 0
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('latin1', at, at + 4)
    const size = bytes.readUInt32LE(at + 4)
    if (id === 'fmt ') {
      channels = bytes.readUInt16LE(at + 10)
      sampleRate = bytes.readUInt32LE(at + 12)
      bits = bytes.readUInt16LE(at + 22)
    } else if (id === 'data') {
      if (channels !== 1 || bits !== 16) {
        throw new Error(`the recording is ${channels}-channel ${bits}-bit, and voices are separated on 16-bit mono`)
      }
      const end = Math.min(bytes.length, at + 8 + size)
      const count = Math.floor((end - at - 8) / 2)
      const samples = new Float32Array(count)
      for (let index = 0; index < count; index += 1) {
        samples[index] = bytes.readInt16LE(at + 8 + index * 2) / 32768
      }
      return { samples, sampleRate }
    }
    at += 8 + size + (size % 2)
  }
  throw new Error('the recording has no audio in it')
}

process.parentPort.once('message', (message: { data: Request }) => {
  try {
    const { file, config } = message.data
    const diarization = new sherpa.OfflineSpeakerDiarization(config)
    const wave = readWave(file)
    if (wave.sampleRate !== diarization.sampleRate) {
      throw new Error(
        `the audio is ${wave.sampleRate} Hz and the voice models need ${diarization.sampleRate} Hz`
      )
    }
    const turns = diarization.process(wave.samples).map((turn) => ({
      start: turn.start,
      end: turn.end,
      speaker: turn.speaker
    }))
    process.parentPort.postMessage({ turns })
  } catch (error) {
    process.parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
})
