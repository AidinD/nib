import { useEffect, useState } from 'react'
import { decodeRecording } from '../lib/decode-audio'
import type { Language } from './RecordPanel'
import { lastLanguage } from '../lib/language'

/*
 * Bringing in a meeting recorded on a phone.
 *
 * The same pre-flight as recording, cut down to the one question that still
 * matters: which language, because the two whisper models are language-specific
 * and a wrong guess is a wrong transcript. There are no levels to watch - the
 * audio already exists.
 *
 * Everything happens on this machine. The file is read, decoded here, written
 * as a 16 kHz WAV beside Nib's own recordings, and transcribed and separated by
 * voice locally. The panel says so, because "where does my colleagues' audio
 * go" is the first question anybody should ask of a feature like this.
 */

/** Where the last import came from, so the picker opens there next time. */
const LAST_FOLDER = 'nib.import.folder'

function lastFolder(): string | undefined {
  try {
    return localStorage.getItem(LAST_FOLDER) ?? undefined
  } catch {
    return undefined
  }
}

interface ImportPanelProps {
  noteId: string
  onImported: (done: { path: string; seconds: number; language: Language; origin: string }) => void
  onClose: () => void
}

export function ImportPanel({ noteId, onImported, onClose }: ImportPanelProps): React.JSX.Element {
  // Asked here, unlike a live recording, because an import is transcribed the
  // moment it is saved - this IS the transcription's moment. Starts on the last
  // language used.
  const [language, setLanguage] = useState<Language>(lastLanguage)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  /*
   * Said before the file is chosen rather than after it is transcribed: without
   * the voice models the words still arrive, but unlabelled, and that is worth
   * knowing while there is still time to install them first.
   */
  const [noVoices, setNoVoices] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void window.nib
      .voicesStatus()
      .then((status) => {
        if (live && !status.ready) {
          setNoVoices(status.why ?? 'the voice models are not installed')
        }
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  const choose = async (): Promise<void> => {
    setFailed(null)
    try {
      setBusy('Opening…')
      const picked = await window.nib.importPick(lastFolder())
      if (picked === null) {
        setBusy(null)
        return
      }
      try {
        localStorage.setItem(LAST_FOLDER, picked.folder)
      } catch {
        // Only a convenience; the picker opens somewhere sensible without it.
      }
      setBusy(`Converting ${picked.name}…`)
      const { samples } = await decodeRecording(picked.bytes)
      if (samples.length < 16000) {
        throw new Error('That recording is shorter than a second, so there is nothing to transcribe.')
      }
      setBusy('Saving…')
      const written = await window.nib.importWrite(
        noteId,
        new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
      )
      onImported({ path: written.path, seconds: written.seconds, language, origin: picked.name })
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error))
      setBusy(null)
    }
  }

  return (
    <div className="record-panel">
      <div className="record-langs">
        <span className="record-title">Import a recording</span>
        <div className="lang-toggle">
          {(['sv', 'en'] as Language[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`lang-option${language === option ? ' is-on' : ''}`}
              onClick={() => setLanguage(option)}
              disabled={busy !== null}
            >
              {option === 'sv' ? 'Svenska' : 'English'}
            </button>
          ))}
        </div>
      </div>

      {failed !== null && <p className="record-failed">{failed}</p>}
      {noVoices !== null && (
        <p className="record-failed">
          Speakers will not be told apart: {noVoices}. The transcript still arrives, unlabelled.
        </p>
      )}
      <p className="record-hint">
        {busy ??
          'A meeting recorded on your phone - an .m4a from Pixel Recorder, or mp3, wav, ogg, flac. It is transcribed and split by voice on this computer; the audio never leaves it.'}
      </p>

      <div className="record-actions">
        <button type="button" className="record-cancel" onClick={onClose} disabled={busy !== null}>
          Cancel
        </button>
        <button
          type="button"
          className="record-go"
          disabled={busy !== null}
          onClick={() => void choose()}
        >
          Choose file…
        </button>
      </div>
    </div>
  )
}
