import { useEffect, useState } from 'react'

/**
 * The line that says a new version has been downloaded, with a button that
 * restarts into it.
 *
 * Without it the update was invisible: it downloaded in the background and
 * installed only when the app was next quit, which for something left open all day
 * is not a time that comes. It sits under the header like the alert strip and
 * carries one action, because the only decision is "now or later" - and "later" is
 * the dismiss, since the update installs on quit anyway.
 */
export function UpdateStrip(): React.JSX.Element | null {
  const [version, setVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // The download may have finished before this window existed.
    void window.nib.pendingUpdate().then(setVersion)
    return window.nib.onUpdateReady(setVersion)
  }, [])

  if (version === null || dismissed) {
    return null
  }

  return (
    <div className="update-strip" role="status">
      <span>
        Nib {version} is ready. It installs when you quit, or now:
      </span>
      <button type="button" className="update-restart" onClick={() => void window.nib.installUpdate()}>
        Restart and update
      </button>
      <button type="button" className="update-later" onClick={() => setDismissed(true)}>
        Later
      </button>
    </div>
  )
}
