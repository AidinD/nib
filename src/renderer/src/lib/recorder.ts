/*
 * Capturing a meeting: both sides of it.
 *
 * The microphone is your half. The other half comes out of the speakers, so it is
 * taken from the machine's own output - see `allowLoopbackAudio` in the main
 * process. Recording only the microphone gets one side of a conversation, which
 * is worse than useless for a transcript: it reads as a monologue with pauses.
 *
 * The two are kept APART, as the two channels of one 16 kHz stereo stream: your
 * microphone on the left, the machine's output on the right. That is what lets
 * the transcript say who spoke, and it is bookkeeping rather than voice
 * recognition - whisper compares the two channels and reports which was louder,
 * so the answer is as good as the separation was. See keel's whisper module.
 *
 * They used to be summed. The reasons not to have both gone: the audio is kept
 * now rather than deleted with the transcript, so there is something to label,
 * and the cost turned out to be eighteen percent of the transcription rather
 * than double it. What it does cost is the file - 3.8 MB a minute against 1.9.
 *
 * ## Echo cancellation stays off, even on speakers
 *
 * On speakers the microphone also hears the far side, so the left channel is not
 * purely you. It survives anyway: the right channel has the call at full level
 * straight off the machine and the left has it through a room, so the right one
 * still wins those segments - and while you talk there is usually nothing coming
 * out of the speakers at all. Where they genuinely overlap whisper answers
 * `speaker ?`, which is the honest answer rather than a wrong name.
 *
 * Turning `echoCancellation` on would clean the left channel up and is the lever
 * to reach for if the labels do smear. It is off because it also processes the
 * one recording of a conversation that cannot be made again, and a transcript is
 * worth more than a label on it.
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

/** You on the left, them on the right - and whisper reads left as speaker 0. */
const MIC_CHANNEL = 0
const SYSTEM_CHANNEL = 1
const CHANNELS = 2

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

/** One float sample as 16-bit PCM, clamped rather than allowed to wrap.
 *  A stream that exceeds 1.0 wraps into loud noise, which is the one artefact a
 *  transcript cannot survive. */
function pcm16(value: number): number {
  const bounded = Math.max(-1, Math.min(1, value))
  return bounded < 0 ? bounded * 0x8000 : bounded * 0x7fff
}

/** Start capturing into the note's own file. */
export async function startRecording(noteId: string): Promise<Recorder> {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  })
  const system = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false })
  const path = await window.nib.startRecording(noteId, CHANNELS)

  const context = new AudioContext({ sampleRate: SAMPLE_RATE })
  /*
   * A merger rather than a gain node, which is the whole change.
   *
   * Each of its inputs is one channel and is down-mixed to mono on the way in -
   * which matters, because the system capture can arrive already in stereo and
   * would otherwise decide the layout for us.
   */
  const merger = context.createChannelMerger(CHANNELS)

  const attach = (stream: MediaStream, channel: number): AnalyserNode => {
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    source.connect(merger, 0, channel)
    return analyser
  }
  // Left is you and right is them, and that order is load-bearing: whisper
  // reports the left channel as speaker 0, and the transcript names them from
  // that. Swapping these two lines swaps every label in every meeting.
  const micNode = attach(mic, MIC_CHANNEL)
  const systemNode = attach(system, SYSTEM_CHANNEL)
  const scratch = new Uint8Array(new ArrayBuffer(micNode.fftSize))

  const processor = context.createScriptProcessor(CHUNK_SAMPLES, CHANNELS, CHANNELS)
  let samples = 0
  processor.onaudioprocess = (event) => {
    const left = event.inputBuffer.getChannelData(MIC_CHANNEL)
    const right = event.inputBuffer.getChannelData(SYSTEM_CHANNEL)
    // Interleaved, which is what a WAV holds: L R L R rather than one channel
    // after the other.
    const frames = new Int16Array(left.length * CHANNELS)
    for (let i = 0; i < left.length; i++) {
      frames[i * 2] = pcm16(left[i])
      frames[i * 2 + 1] = pcm16(right[i])
    }
    // Frames, not samples - so `seconds` stays a length in time whatever the
    // channel count is.
    samples += left.length
    window.nib.sendChunk(new Uint8Array(frames.buffer))
  }
  merger.connect(processor)
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
