/*
 * Capturing a meeting: both sides of it.
 *
 * The microphone is your half. The other half comes out of the speakers, so it is
 * taken from the machine's own output - see `allowLoopbackAudio` in the main
 * process. Recording only the microphone gets one side of a conversation, which
 * is worse than useless for a transcript: it reads as a monologue with pauses.
 *
 * The two are mixed into one 16 kHz mono stream, which is what whisper reads.
 * Keeping them apart would allow speaker labels later, and is deliberately not
 * done yet: it doubles the transcription and the recording is deleted as soon as
 * the transcript exists, so there would be nothing left to go back to.
 *
 * `ScriptProcessorNode` is deprecated and used anyway. Its replacement needs a
 * separate module loaded by URL, which fights the bundler for no gain here, and
 * the samples have to reach the main process every few hundred milliseconds
 * regardless. The same trade the editor makes with `execCommand`, for the same
 * reason: the deprecated thing works and the replacement costs more than it
 * returns.
 */

/** What whisper resamples everything to, so there is no point capturing more. */
const SAMPLE_RATE = 16000

/** ~250ms at 16kHz. Small enough that a crash costs a quarter of a second. */
const CHUNK_SAMPLES = 4096

export interface Levels {
  /** 0..1, how loud each side is right now - the self-test before you start. */
  mic: number
  system: number
}

export interface Recorder {
  /** Where the file is being written, for deleting it after transcription. */
  path: string
  levels: () => Levels
  /** Seconds captured so far, from the samples themselves rather than a clock. */
  seconds: () => number
  stop: () => Promise<{ path: string; seconds: number; bytes: number } | null>
}

/**
 * Peak deviation from silence in a buffer, 0..1.
 *
 * The scratch buffer is typed as backed by a plain ArrayBuffer, not the wider
 * `ArrayBufferLike`: `getByteTimeDomainData` will not accept a view that might
 * sit on a SharedArrayBuffer, and the default inference is the wider one.
 */
function peak(analyser: AnalyserNode, scratch: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(scratch)
  let loudest = 0
  for (const value of scratch) {
    const distance = Math.abs(value - 128)
    if (distance > loudest) {
      loudest = distance
    }
  }
  return Math.min(1, loudest / 128)
}

/**
 * Open both streams without recording, so the levels can be watched.
 *
 * The five seconds before a meeting are the only chance to notice that the wrong
 * device is selected. Afterwards it is forty-five minutes of silence, and there
 * is no way to get the conversation back.
 */
export async function openSelfTest(): Promise<{
  levels: () => Levels
  close: () => Promise<void>
  microphone: string
  system: string
}> {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  })
  const system = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false })

  const context = new AudioContext({ sampleRate: SAMPLE_RATE })
  const listen = (stream: MediaStream): AnalyserNode => {
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    context.createMediaStreamSource(stream).connect(analyser)
    return analyser
  }
  const micNode = listen(mic)
  const systemNode = listen(system)
  const scratch = new Uint8Array(new ArrayBuffer(micNode.fftSize))

  return {
    microphone: mic.getAudioTracks()[0]?.label ?? '',
    system: system.getAudioTracks()[0]?.label ?? '',
    levels: () => ({ mic: peak(micNode, scratch), system: peak(systemNode, scratch) }),
    close: async () => {
      mic.getTracks().forEach((track) => track.stop())
      system.getTracks().forEach((track) => track.stop())
      await context.close()
    }
  }
}

/** Start capturing into the note's own file. */
export async function startRecording(noteId: string): Promise<Recorder> {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  })
  const system = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false })
  const path = await window.nib.startRecording(noteId)

  const context = new AudioContext({ sampleRate: SAMPLE_RATE })
  const mixer = context.createGain()

  const attach = (stream: MediaStream): AnalyserNode => {
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    source.connect(mixer)
    return analyser
  }
  const micNode = attach(mic)
  const systemNode = attach(system)
  const scratch = new Uint8Array(new ArrayBuffer(micNode.fftSize))

  const processor = context.createScriptProcessor(CHUNK_SAMPLES, 1, 1)
  let samples = 0
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0)
    const pcm = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      // Clamp before scaling: two summed streams can exceed 1.0 and wrap into
      // loud noise, which is the one artefact a transcript cannot survive.
      const value = Math.max(-1, Math.min(1, input[i]))
      pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff
    }
    samples += input.length
    window.nib.sendChunk(new Uint8Array(pcm.buffer))
  }
  mixer.connect(processor)
  // A destination the processor can run into. Zero gain, so nothing is played
  // back - a recording that echoes itself into the room is its own feedback loop.
  const silence = context.createGain()
  silence.gain.value = 0
  processor.connect(silence)
  silence.connect(context.destination)

  return {
    path,
    levels: () => ({ mic: peak(micNode, scratch), system: peak(systemNode, scratch) }),
    seconds: () => Math.round(samples / SAMPLE_RATE),
    stop: async () => {
      processor.disconnect()
      processor.onaudioprocess = null
      mic.getTracks().forEach((track) => track.stop())
      system.getTracks().forEach((track) => track.stop())
      await context.close()
      return window.nib.stopRecording()
    }
  }
}
