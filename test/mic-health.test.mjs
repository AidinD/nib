/**
 * The microphone check that runs during a recording, against synthetic signals.
 *
 * Found on a meeting where the default mic was at 0% input volume: the device
 * delivered constant loud noise, never fell to a floor, and the transcript of
 * that side was lost. These signals are built here from numbers - no recorded
 * audio - with the shapes that were measured: noise around RMS 0.4 with one
 * sample in a hundred clipped and neighbouring samples correlating at about 0.5,
 * against speech with pauses that correlates at 0.9 and above.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { chunkStats, micProblem, MicWatch, micWarning } from '../src/renderer/src/lib/mic-health.ts'

const RATE = 16000
const CHUNK = 4096

/** A deterministic random source, so a failure is the same failure every run. */
function random(seed) {
  let state = seed
  return () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647
  }
}

/** Roughly normal, from twelve uniforms. */
function gaussian(next) {
  let sum = 0
  for (let at = 0; at < 12; at += 1) {
    sum += next()
  }
  return sum - 6
}

const clamp = (value) => Math.max(-1, Math.min(1, value))

/** Loud, correlated-but-not-speechlike noise with clipping: the measured failure. */
function constantNoise(seconds, seed = 1) {
  const next = random(seed)
  const out = new Float32Array(seconds * RATE)
  let previous = 0
  for (let at = 0; at < out.length; at += 1) {
    previous = 0.5 * previous + gaussian(next) * 0.36
    out[at] = clamp(previous)
  }
  return out
}

/**
 * Something with the shape of speech: voiced phrases of a few syllables, each a
 * low fundamental with harmonics under a syllable envelope, separated by pauses
 * that drop to a quiet room floor.
 */
function speech(seconds, { level = 0.25, pauses = true, seed = 2 } = {}) {
  const next = random(seed)
  const out = new Float32Array(seconds * RATE)
  let at = 0
  while (at < out.length) {
    const phrase = Math.round((pauses ? 1 + next() * 2 : seconds) * RATE)
    const f0 = 110 + next() * 110
    for (let i = 0; i < phrase && at < out.length; i += 1, at += 1) {
      const t = i / RATE
      const syllable = 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * 4 * t))
      const voice =
        Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(4 * Math.PI * f0 * t) + 0.25 * Math.sin(6 * Math.PI * f0 * t)
      out[at] = clamp(level * syllable * voice * 0.6 + gaussian(next) * 0.0005)
    }
    if (pauses) {
      const pause = Math.round((0.5 + next()) * RATE)
      for (let i = 0; i < pause && at < out.length; i += 1, at += 1) {
        out[at] = gaussian(next) * 0.0008
      }
    }
  }
  return out
}

const silence = (seconds) => new Float32Array(seconds * RATE)

/** Feed two channels through the watch in recorder-sized chunks; the last verdict. */
function judge(mic, system) {
  const watch = new MicWatch()
  for (let at = 0; at + CHUNK <= mic.length; at += CHUNK) {
    watch.push(chunkStats(mic.subarray(at, at + CHUNK), system.subarray(at, at + CHUNK)))
  }
  return watch.problem()
}

test('a constant-noise microphone raises the noise warning', () => {
  assert.equal(judge(constantNoise(12), speech(12, { seed: 3 })), 'noise')
})

test('quieter noise still raises it, because it does not have the shape of speech', () => {
  const quieter = constantNoise(12).map((value) => value * 0.25)
  assert.equal(judge(quieter, silence(12)), 'noise')
})

test('the fixture has the measured shape: loud, a little clipped, not smooth like speech', () => {
  const stats = chunkStats(constantNoise(1), silence(1))
  assert.ok(stats.micRms > 0.3 && stats.micRms < 0.5, `rms ${stats.micRms}`)
  assert.ok(stats.micClipped > 0.002 && stats.micClipped < 0.03, `clipped ${stats.micClipped}`)
  const lag = stats.micLagSum / stats.micEnergy
  assert.ok(lag > 0.3 && lag < 0.7, `lag ${lag}`)
})

test('a silent microphone while the call talks raises the silent warning', () => {
  assert.equal(judge(silence(22), speech(22, { seed: 4 })), 'silent')
})

test('silence is not judged before twenty seconds', () => {
  // Listening for a while is normal; the noise check is the fast one.
  assert.equal(judge(silence(15), speech(15, { seed: 4 })), null)
})

test('a silent microphone with nothing on the call either says nothing', () => {
  assert.equal(judge(silence(22), silence(22)), null)
})

test('speech with pauses raises nothing', () => {
  assert.equal(judge(speech(30, { seed: 5 }), speech(30, { seed: 6, level: 0.1 })), null)
})

test('a loud talker with no pause at all is still not noise', () => {
  // The quietest second is loud, but the samples follow one another like speech.
  assert.equal(judge(speech(12, { pauses: false, level: 0.4, seed: 7 }), silence(12)), null)
})

test('a quiet room floor is not silence', () => {
  // A powered microphone with nobody talking still hears the room.
  const next = random(9)
  const floor = Float32Array.from({ length: 22 * RATE }, () => gaussian(next) * 0.003)
  assert.equal(judge(floor, speech(22, { seed: 8 })), null)
})

test('nothing is judged before ten seconds have been heard', () => {
  assert.equal(micProblem([]), null)
  assert.equal(judge(constantNoise(8), silence(8)), null)
})

test('the warning names the device being recorded, or says it is the default', () => {
  assert.ok(micWarning('noise', 'Microphone (Virtual Device)').includes('“Microphone (Virtual Device)”'))
  assert.ok(micWarning('silent', '').includes('the Windows default microphone'))
  assert.ok(micWarning('silent', 'X').includes('input volume'))
})
