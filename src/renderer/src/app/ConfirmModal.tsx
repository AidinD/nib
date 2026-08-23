import { useEffect, useRef } from 'react'

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The app's own confirmation dialog, used instead of `window.confirm`.
 *
 * Two reasons it is hand-rolled: the native dialog is a light-mode Windows box
 * in the middle of a dark frameless app, and it blocks the renderer thread while
 * it is up. This one matches the app and cannot.
 *
 * Cancel takes focus, as in Jot: for a destructive prompt an absent-minded
 * Enter should cancel, not confirm.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel
}: ConfirmModalProps): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onCancel])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">{title}</h2>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="modal-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="modal-btn is-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
