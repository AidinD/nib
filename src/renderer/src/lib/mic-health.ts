/*
 * Is the microphone channel usable - asked while the meeting is still on.
 *
 * Found on a meeting where the default mic was at 0% input volume. The meeting
 * app had switched to another microphone, Nib went on recording the Windows
 * default, and that device - a virtual one - delivered constant loud noise
 * instead of silence: its level never fell to a floor in twenty-one minutes,
 * about one sample in a hundred was clipped, and it did not have the shape of
 * speech. The far side was fine. whisper turned the left channel into one
 * phrase repeated, and the transcript was lost - which nobody could see until
 * the meeting was over and could not be had again.
 *
 * So the recording watches its own left channel, over the last ten seconds, for
 * two shapes that a microphone in real use never has:
 *
 * - **silent**: nothing at all on the microphone for twenty seconds while the
 *   call is clearly audible. Longer than the noise check, and worded as a
 *   question, because a noise-removing microphone (the virtual kind) sends
 *   true digital silence whenever you are quiet - so "you have been listening"
 *   and "your input volume is at 0%" look the same, and only the person knows
 *   which. It clears the moment the microphone hears anything.
 * - **noise**: loud with no quiet in it. Speech has pauses, so the quietest
 *   second in any ten is near the floor. When even that second is loud, it is
 *   not somebody talking. Very loud on its own is enough; moderately loud also
 *   needs the signal to not look like speech - samples that do not follow from
 *   one another (speech at 16 kHz is smooth: neighbouring samples correlate at
 *   0.9 and above, the noise measured 0.38 to 0.62) or clipping.
 *
 * Tuned to warn too often rather than too late: a false warning costs a glance,
 * a missed one costs the meeting. It only ever warns - the recording runs on,
 * because the other channel may still be worth everything.
 */

/** Statistics for one chunk of both channels, about a quarter of a second. */
export interface ChunkStats {
  /** Length of the chunk in seconds. */
  seconds: number
  micRms: number
  micPeak: number
  /** Share of the chunk's samples at full scale. */
  micClipped: number
  /** Sum of neighbouring products and of squares, for the lag-1 correlation. */
  micLagSum: number
  micEnergy: number
  systemRms: number
}

export type MicProblem = 'silent' | 'noise'

const SAMPLE_RATE = 16000

/** How far back the noise check looks. */
export const WATCH_SECONDS = 10
/** How far back the silence check looks - longer, see the note above. */
export const SILENT_SECONDS = 20
/**
 * Below this peak on every chunk, the microphone heard nothing: 64 of 32768,
 * about -54 dBFS. A powered microphone in a room breaks it within seconds -
 * breath, a chair, a keyboard - and a device at 0% input volume never does.
 */
const DEAD_PEAK = 64 / 32768
/** The call counts as audible in a chunk above this level (about -46 dBFS). */
const SYSTEM_ACTIVE_RMS = 0.005
/** ...and as clearly audible when a quarter of the window is. */
const SYSTEM_ACTIVE_SHARE = 0.25
/** The quietest second this loud is no floor at all, speech or not (about -10 dBFS):
 *  speech cannot hold this for a whole second without clipping. The noise measured
 *  0.34 to 0.46. */
const NOISE_ALWAYS_RMS = 0.3
/** The quietest second this loud is suspicious (about -30 dBFS)... */
const NOISE_MAYBE_RMS = 0.03
/** ...when the samples do not follow one another the way speech does... */
const SPEECH_LAG = 0.8
/** ...or when this share of samples is clipped. */
const CLIPPED_SHARE = 0.001

/** Measure one chunk. Both arrays are the same length, -1..1. */
export function chunkStats(mic: Float32Array, system: Float32Array): ChunkStats {
  let energy = 0
  let lag = 0
  let peak = 0
  let clipped = 0
  for (let at = 0; at < mic.length; at += 1) {
    const value = mic[at]
    energy += value * value
    if (at > 0) {
      lag += value * mic[at - 1]
    }
    const size = Math.abs(value)
    if (size > peak) {
      peak = size
    }
    if (size >= 0.999) {
      clipped += 1
    }
  }
  let systemEnergy = 0
  for (const value of system) {
    systemEnergy += value * value
  }
  const count = Math.max(1, mic.length)
  return {
    seconds: mic.length / SAMPLE_RATE,
    micRms: Math.sqrt(energy / count),
    micPeak: peak,
    micClipped: clipped / count,
    micLagSum: lag,
    micEnergy: energy,
    systemRms: Math.sqrt(systemEnergy / Math.max(1, system.length))
  }
}

/**
 * What is wrong with the microphone over these chunks, oldest first, or null.
 *
 * Null until a whole window has been heard: the first seconds of a recording
 * are the person settling in, and a warning before anything could have been
 * said is a warning about nothing.
 */
export function micProblem(all: readonly ChunkStats[]): MicProblem | null {
  const span = (list: readonly ChunkStats[]): number => list.reduce((sum, chunk) => sum + chunk.seconds, 0)
  /** The newest chunks covering `seconds`, or null when not that much has been heard. */
  const last = (seconds: number): ChunkStats[] | null => {
    const picked: ChunkStats[] = []
    for (let at = all.length - 1; at >= 0 && span(picked) < seconds * 0.95; at -= 1) {
      picked.unshift(all[at])
    }
    return span(picked) >= seconds * 0.95 ? picked : null
  }

  const quiet = last(SILENT_SECONDS)
  if (quiet !== null) {
    const audible = quiet.filter((chunk) => chunk.systemRms >= SYSTEM_ACTIVE_RMS).length / quiet.length
    if (quiet.every((chunk) => chunk.micPeak < DEAD_PEAK) && audible >= SYSTEM_ACTIVE_SHARE) {
      return 'silent'
    }
  }

  const chunks = last(WATCH_SECONDS)
  if (chunks === null) {
    return null
  }

  // The quietest stretch of about a second.
  const perSecond = Math.max(1, Math.round(1 / (chunks[0].seconds || 1)))
  let quietest = Infinity
  for (let start = 0; start + perSecond <= chunks.length; start += 1) {
    const stretch = chunks.slice(start, start + perSecond)
    const energy = stretch.reduce((sum, chunk) => sum + chunk.micRms * chunk.micRms, 0) / stretch.length
    quietest = Math.min(quietest, Math.sqrt(energy))
  }
  if (quietest >= NOISE_ALWAYS_RMS) {
    return 'noise'
  }
  if (quietest >= NOISE_MAYBE_RMS) {
    const energy = chunks.reduce((sum, chunk) => sum + chunk.micEnergy, 0)
    const lag = energy > 0 ? chunks.reduce((sum, chunk) => sum + chunk.micLagSum, 0) / energy : 1
    const clipped = chunks.reduce((sum, chunk) => sum + chunk.micClipped, 0) / chunks.length
    if (lag < SPEECH_LAG || clipped >= CLIPPED_SHARE) {
      return 'noise'
    }
  }
  return null
}

/** The last `SILENT_SECONDS` of chunks, and the judgement on them. */
export class MicWatch {
  private chunks: ChunkStats[] = []

  push(chunk: ChunkStats): void {
    this.chunks.push(chunk)
    let total = this.chunks.reduce((sum, item) => sum + item.seconds, 0)
    while (this.chunks.length > 1 && total - this.chunks[0].seconds >= SILENT_SECONDS) {
      total -= this.chunks[0].seconds
      this.chunks.shift()
    }
  }

  problem(): MicProblem | null {
    return micProblem(this.chunks)
  }
}

/**
 * What to tell the person, naming the device actually being recorded.
 *
 * The device name is the whole point: the failure that prompted this was a
 * meeting app using one microphone while Nib recorded another, and "the
 * microphone" does not tell you which of the two to go and look at.
 */
export function micWarning(problem: MicProblem, device: string): string {
  const named = device.trim().length > 0 ? `“${device.trim()}”` : 'the Windows default microphone'
  const check = `Check that device's input volume in Windows sound settings, and that it is the microphone your meeting is using - Nib records the Windows default.`
  return problem === 'silent'
    ? `Your microphone has heard nothing for 20 seconds while the call is talking. If you have spoken in that time, Nib is not hearing you: it is recording ${named}. ${check}`
    : `Your microphone is recording constant loud noise, not speech, so your side will not transcribe. Nib is recording ${named}. ${check}`
}
