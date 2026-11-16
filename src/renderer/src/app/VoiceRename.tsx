import { useEffect, useRef, useState } from 'react'

/*
 * Naming a voice in a transcript.
 *
 * Opened by clicking any "Speaker 2" - on a line or on the transcript's summary
 * line - and applied to every line that voice spoke, so it is done once per
 * voice rather than once per turn. Enter keeps it, Escape leaves it as it was,
 * and an empty name puts the number back.
 *
 * "Jag" is the name that says which voice is you. The summary is told so, and it
 * is what lets it keep your promises apart from everybody else's.
 *
 * Clicking away keeps what was typed. A name typed and lost to a stray click is
 * the more annoying of the two mistakes, and Escape is there for the other one.
 */

interface VoiceRenameProps {
  at: { left: number; top: number }
  name: string
  onRename: (name: string) => void
  onClose: () => void
}

export function VoiceRename({ at, name, onRename, onClose }: VoiceRenameProps): React.JSX.Element {
  const [value, setValue] = useState(name)
  const input = useRef<HTMLInputElement | null>(null)
  /** Set once the panel has answered, so the blur that follows cannot answer again. */
  const done = useRef(false)
  const finish = (rename: boolean): void => {
    if (done.current) {
      return
    }
    done.current = true
    if (rename && value.trim() !== name.trim()) {
      onRename(value)
    } else {
      onClose()
    }
  }

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  return (
    <form
      className="voice-rename"
      style={{ left: at.left, top: at.top }}
      onSubmit={(event) => {
        event.preventDefault()
        finish(true)
      }}
    >
      <input
        ref={input}
        value={value}
        placeholder="Name - Jag if it is you"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            finish(false)
          }
        }}
        onBlur={() => finish(true)}
      />
      <span className="voice-rename-hint">Renames every line this voice spoke</span>
    </form>
  )
}
