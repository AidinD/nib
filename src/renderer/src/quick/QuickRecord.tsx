import { useEffect, useRef, useState } from 'react'
import { INBOX_NAME, QUICK_KEY_LABEL } from '@shared/quick-record'
import type { QuickState } from '@shared/quick-record'

/*
 * The Ctrl+Alt+, prompt - its own small window, over whatever is on screen.
 *
 * Nothing in it is required. Enter on an empty field records, because the
 * moment this is for is a call that has already started; a name is a courtesy
 * to the person who has to file it later, and the Inbox note gets the date and
 * minute without one. No language either: that is chosen on the recording's
 * block when it is transcribed - see lib/language.ts. See src/main/quick.ts and
 * DECISIONS 2026-11-27.
 */

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function QuickRecord(): React.JSX.Element {
  const [state, setState] = useState<QuickState | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void window.nib.quick.state().then(setState)
    return window.nib.quick.onReset((next) => {
      // A fresh prompt every time it is shown: last time's half-typed name is
      // last time's meeting.
      setState(next)
      setName('')
      setBusy(false)
      setError(null)
      window.setTimeout(() => (next.recording === null ? input.current : panel.current)?.focus(), 0)
    })
  }, [])

  // The running clock, while the prompt is showing a recording.
  const recording = state?.recording ?? null
  useEffect(() => {
    if (recording === null) {
      return
    }
    const timer = window.setInterval(() => {
      void window.nib.quick.state().then(setState)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [recording === null])

  const start = async (): Promise<void> => {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.nib.quick.start({ name })
    if (!result.ok) {
      setError(result.error)
    }
    setBusy(false)
  }

  const stop = async (): Promise<void> => {
    if (busy) {
      return
    }
    setBusy(true)
    const result = await window.nib.quick.stop()
    if (!result.ok) {
      setError(result.error ?? 'Could not stop the recording.')
    }
    setBusy(false)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      window.nib.quick.close()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void (recording === null ? start() : stop())
    }
  }

  return (
    <div className="quick" ref={panel} tabIndex={-1} onKeyDown={onKeyDown}>
      {recording === null ? (
        <>
          <div className="quick-head">
            <span className="quick-title">Record</span>
          </div>
          <input
            ref={input}
            className="quick-name"
            placeholder="Name (optional)"
            value={name}
            readOnly={busy}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <p className="quick-hint">
            {busy ? 'Starting…' : `Enter records into a new note in ${INBOX_NAME}. Esc closes.`}
          </p>
        </>
      ) : (
        <>
          <div className="quick-head">
            <span className="recording-dot" />
            <span className="quick-title">Recording {clock(recording.seconds)}</span>
          </div>
          <p className="quick-note">{recording.title}</p>
          <div className="quick-actions">
            <button type="button" className="quick-stop" disabled={busy} onClick={() => void stop()}>
              Stop
            </button>
            <button type="button" onClick={() => void window.nib.quick.open()}>
              Open note
            </button>
            <span className="quick-hint">Enter stops. Esc keeps recording.</span>
          </div>
        </>
      )}
      {error !== null && <p className="quick-error">{error}</p>}
      {state !== null && !state.registered && (
        <p className="quick-error">{QUICK_KEY_LABEL} is held by another program.</p>
      )}
    </div>
  )
}
