import { availableParallelism } from 'os'
import { join } from 'path'
import { utilityProcess } from 'electron'
import { diarizeConfig, diarizeStatus } from 'keel/diarize'
import type { VoiceTurn } from 'keel/diarize'

/*
 * Who spoke, for a recording with one microphone - the main process's half.
 *
 * The work itself happens in `diarize-worker.ts`, in a utility process; this
 * file decides whether it can run at all, starts it, and makes sure it ends.
 * See `keel/diarize` for the models and why these, and DECISIONS.md for what was
 * measured.
 *
 * Every failure here is an answer, not an exception the transcript could trip
 * over: the words are already in the note by the time this runs, and a voice
 * model that is missing or a process that dies must leave them there, saying
 * why the lines are unlabelled.
 */

export type VoicesResult = { ok: true; turns: VoiceTurn[] } | { ok: false; why: string }

/**
 * One fewer than the machine has, so a meeting being separated does not make
 * the note you are typing in stutter. Measured on six cores: four threads took
 * a 45-minute meeting in a little over five minutes.
 */
function threads(): number {
  return Math.max(1, Math.min(8, availableParallelism() - 1))
}

/**
 * Long enough for the slowest machine this is likely to meet, short enough that
 * a hung process does not hold a block at "separating voices" for ever. The
 * measured rate is about a tenth of real time, so this allows five times that.
 */
function deadline(seconds: number): number {
  return (120 + seconds * 0.5) * 1000
}

export function voicesStatus(roots: string[]): { ready: boolean; why?: string } {
  const status = diarizeStatus({ roots })
  return status.ready ? { ready: true } : { ready: false, why: status.why }
}

/** Separate the voices in a 16 kHz mono WAV. Never rejects. */
export function diarizeFile(file: string, seconds: number, roots: string[]): Promise<VoicesResult> {
  const status = diarizeStatus({ roots })
  if (!status.ready) {
    return Promise.resolve({ ok: false, why: status.why })
  }

  return new Promise((done) => {
    let settled = false
    const finish = (result: VoicesResult): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      done(result)
    }

    const child = utilityProcess.fork(join(__dirname, 'diarize-worker.js'), [], {
      serviceName: 'Nib voice separation',
      stdio: 'ignore'
    })
    const timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, why: 'separating the voices took too long and was stopped' })
    }, deadline(seconds))

    child.on('message', (message: { turns?: VoiceTurn[]; error?: string }) => {
      if (message.turns !== undefined) {
        finish({ ok: true, turns: message.turns })
      } else {
        finish({ ok: false, why: message.error ?? 'the voice separation gave no answer' })
      }
      child.kill()
    })
    child.on('exit', (code) => {
      finish({ ok: false, why: `the voice separation stopped unexpectedly (exit ${code})` })
    })
    child.postMessage({ file, config: diarizeConfig(status, threads()) })
  })
}
