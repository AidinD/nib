/*
 * Turning a phone's recording into what whisper and the voice models read.
 *
 * A Pixel's Recorder app shares an `.m4a` holding AAC. Both engines want 16 kHz,
 * one channel, 16-bit samples. Chromium already carries an AAC decoder - and an
 * MP3, Opus, FLAC and WAV one - so the conversion is done here, in the page,
 * rather than by a converter that would have to be installed beside the app.
 *
 * An OfflineAudioContext at 16 kHz is what does the resampling: `decodeAudioData`
 * hands back the audio at the context's own rate, whatever the file was
 * recorded at. The context is never rendered; it exists for its rate.
 *
 * Memory is the cost to know about. The decode holds the whole recording as
 * 32-bit floats at 16 kHz - about 170 MB for a 45-minute mono meeting - for the
 * few seconds this takes, and the result passed back is half of that again.
 */

const RATE = 16000

/** Mix down to one channel and quantise to 16 bits, little-endian. */
export function toMono16(channels: Float32Array[], length: number): Int16Array {
  const out = new Int16Array(length)
  const count = Math.max(1, channels.length)
  for (let at = 0; at < length; at += 1) {
    let sum = 0
    for (const channel of channels) {
      sum += channel[at] ?? 0
    }
    const value = Math.max(-1, Math.min(1, sum / count))
    out[at] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767)
  }
  return out
}

/**
 * Decode any audio file Chromium can play into 16 kHz mono samples.
 *
 * Throws with a sentence a person can act on when the file is not audio, or is
 * audio in a format this cannot read.
 */
export async function decodeRecording(bytes: Uint8Array): Promise<{ samples: Int16Array; seconds: number }> {
  const context = new OfflineAudioContext(1, 1, RATE)
  // `decodeAudioData` detaches the buffer it is given, so it gets its own copy.
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  let audio: AudioBuffer
  try {
    audio = await context.decodeAudioData(copy)
  } catch {
    throw new Error('That file could not be read as audio. A Pixel recording shares as .m4a; mp3, wav, ogg and flac also work.')
  }
  const channels = Array.from({ length: audio.numberOfChannels }, (_unused, at) => audio.getChannelData(at))
  return { samples: toMono16(channels, audio.length), seconds: audio.length / RATE }
}
