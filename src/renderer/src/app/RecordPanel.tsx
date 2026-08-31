import { useEffect, useRef, useState } from 'react'
import { openSelfTest, startRecording } from '../lib/recorder'
import type { Levels, Recorder } from '../lib/recorder'

/*
 * Starting a recording, and watching it run.
 *
 * Two things happen here that could have been separate and should not be. The
 * language is chosen at the moment you press start, because that is when you know
 * which meeting this is - and the two models are language-specific, so a wrong
 * guess is not a flag, it is a wrong transcript. And the levels are shown BEFORE
 * anything is captured, because the expensive mistake in this whole feature is
 * forty-five minutes of silence from a device that was never listening, and the
 * five seconds before a meeting are the only chance to notice.
 */

export type Language = 'sv' | 'en'

interface RecordPanelProps {
  /** The note this belongs to - the file is named after it, so an orphan left by
   *  a crash says which meeting it was. */
  noteId: string
  onStarted: (recorder: Recorder, language: Language) => void
  onClose: () => void
}

/** A meter that reads as a meter rather than as a progress bar. */
function Meter({ label, level, hint }: { label: string; level: number; hint: string }): React.JSX.Element {
  return (
    <div className="meter">
      <span className="meter-label">{label}</span>
      <div className="meter-track">
        {/* Square root, not the raw peak: quiet speech is around 0.05 linear and
            would show as a dead meter, which is the one thing this must never
            do - it is here to prove the device is alive. */}
        <div className="meter-fill" style={{ width: `${Math.round(Math.sqrt(level) * 100)}%` }} />
      </div>
      <span className="meter-hint">{hint}</span>
    </div>
  )
}

export function RecordPanel({ noteId, onStarted, onClose }: RecordPanelProps): React.JSX.Element {
  const [language, setLanguage] = useState<Language>('sv')
  const [levels, setLevels] = useState<Levels>({ mic: 0, system: 0 })
  const [devices, setDevices] = useState<{ microphone: string; system: string } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const test = useRef<Awaited<ReturnType<typeof openSelfTest>> | null>(null)
  /*
   * Whether each side has EVER been heard, not whether it is loud right now.
   * Speech has gaps, and a tick that flickered off between words would say the
   * device had failed when it is working perfectly.
   */
  const heard = useRef({ mic: false, system: false })

  useEffect(() => {
    let live = true
    let timer = 0

    openSelfTest()
      .then((session) => {
        if (!live) {
          void session.close()
          return
        }
        test.current = session
        setDevices({ microphone: session.microphone, system: session.system })
        const tick = (): void => {
          const next = session.levels()
          if (next.mic > 0.02) heard.current.mic = true
          if (next.system > 0.02) heard.current.system = true
          setLevels(next)
          timer = window.setTimeout(tick, 100)
        }
        tick()
      })
      .catch((error: Error) => setFailed(error.message))

    return () => {
      live = false
      window.clearTimeout(timer)
      void test.current?.close()
      test.current = null
    }
  }, [])

  const start = async (): Promise<void> => {
    setStarting(true)
    try {
      // The self-test's streams are closed first: two open captures of the same
      // device is a way to end up recording one of them and metering the other.
      await test.current?.close()
      test.current = null
      const recorder = await startRecording(noteId)
      onStarted(recorder, language)
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error))
      setStarting(false)
    }
  }

  return (
    <div className="record-panel">
      <div className="record-langs">
        <span className="record-title">Record the meeting</span>
        <div className="lang-toggle">
          {(['sv', 'en'] as Language[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`lang-option${language === option ? ' is-on' : ''}`}
              onClick={() => setLanguage(option)}
            >
              {option === 'sv' ? 'Svenska' : 'English'}
            </button>
          ))}
        </div>
      </div>

      {failed !== null ? (
        <p className="record-failed">{failed}</p>
      ) : (
        <>
          <Meter
            label="You"
            level={levels.mic}
            hint={heard.current.mic ? 'heard' : devices?.microphone.slice(0, 22) ?? '…'}
          />
          <Meter
            label="Them"
            level={levels.system}
            hint={heard.current.system ? 'heard' : 'say something, or play a sound'}
          />
          <p className="record-hint">
            Both meters should move before you start. The far side of a call comes
            through “Them”.
          </p>
        </>
      )}

      <div className="record-actions">
        <button type="button" className="record-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="record-go"
          disabled={starting || failed !== null}
          onClick={() => void start()}
        >
          {starting ? 'Starting…' : 'Start'}
        </button>
      </div>
    </div>
  )
}

/** The strip that replaces the button while a meeting is being recorded. */
export function RecordingBar({
  recorder,
  onMark,
  onStop
}: {
  recorder: Recorder
  /** Pin the line being typed to this minute of the recording. */
  onMark: () => void
  onStop: () => void
}): React.JSX.Element {
  const [seconds, setSeconds] = useState(0)
  const [levels, setLevels] = useState<Levels>({ mic: 0, system: 0 })

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds(recorder.seconds())
      setLevels(recorder.levels())
    }, 200)
    return () => window.clearInterval(timer)
  }, [recorder])

  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60

  return (
    <div className="recording-bar">
      <span className="recording-dot" />
      <span className="recording-time">
        {minutes}:{String(rest).padStart(2, '0')}
      </span>
      <div className="recording-levels">
        <span className="recording-level" style={{ opacity: 0.25 + Math.sqrt(levels.mic) * 0.75 }} />
        <span
          className="recording-level"
          style={{ opacity: 0.25 + Math.sqrt(levels.system) * 0.75 }}
        />
      </div>
      {/*
        Marking the moment, not the note.

        `onMouseDown` is prevented so the caret stays where it was: this marks
        the line being typed, and a button that took focus first would have
        nothing to mark by the time it ran.
      */}
      <button
        type="button"
        className="recording-mark"
        title="Markera den här raden i inspelningen"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onMark}
      >
        Mark
      </button>
      <button type="button" className="recording-stop" onClick={onStop}>
        Stop
      </button>
    </div>
  )
}
