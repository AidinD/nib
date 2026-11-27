import { useEffect, useState } from 'react'
import { QUICK_KEY_LABEL } from '@shared/quick-record'

/**
 * The line that says Ctrl+Alt+, is not Nib's.
 *
 * Registering a global hotkey fails quietly when another program already holds
 * it - Electron answers false and nothing else happens - and a key that does
 * nothing reads as a broken feature, not as a clash. So the clash is said once,
 * where it will be seen, with what to do about it. Dismissed for this run only:
 * the next start tries again, and says it again if it is still taken.
 */
export function HotkeyStrip(): React.JSX.Element | null {
  const [taken, setTaken] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    void window.nib.quick.registered().then((registered) => setTaken(!registered))
  }, [])

  if (!taken || dismissed) {
    return null
  }

  return (
    <div className="update-strip" role="status">
      <span>
        {QUICK_KEY_LABEL} (quick record) could not be registered - another program is using
        it. Close that program and restart Nib to get it back.
      </span>
      <button type="button" className="update-later" onClick={() => setDismissed(true)}>
        Dismiss
      </button>
    </div>
  )
}
