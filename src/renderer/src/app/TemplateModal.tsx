import { useEffect, useRef, useState } from 'react'
import { today } from '@shared/templates'

/**
 * Turning the note in front of you into a template.
 *
 * Only three things are asked, and none of them is the body: the body is the
 * note, which is the entire point of saving one from here rather than from a
 * settings screen. You find out a question is worded wrong while using it, so
 * the place to fix the wording is the note you just used, and the place to keep
 * it is a button on the same screen.
 *
 * The title pattern is the field that needs explaining, so it explains itself:
 * `{date}` is the only substitution there is, and what it produces is shown
 * under the field as you type. A pattern language you have to read documentation
 * for is a pattern language nobody uses correctly.
 */
export function TemplateModal({
  suggestedName,
  tagCount,
  onSave,
  onCancel
}: {
  /** The note's own title, as a starting point for the template's name. */
  suggestedName: string
  /** How many tags come with it, said out loud so it is not a surprise later. */
  tagCount: number
  onSave: (fields: { name: string; title: string; description: string }) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState(suggestedName.trim())
  const [title, setTitle] = useState('{date} ')
  const [description, setDescription] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
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

  const preview = title.trim().replace(/\{date\}/g, today()).trim()
  const ready = name.trim().length > 0

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal template-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal-title">Save as a template</h2>
        <p className="modal-message">
          The body of this note becomes the shape the next one starts with.
          {tagCount > 0 && ` Its ${tagCount === 1 ? 'tag comes' : `${tagCount} tags come`} with it.`}
        </p>

        <label className="template-field">
          <span className="template-label">What to call it</span>
          <input
            ref={nameRef}
            className="add-note"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="1-1"
          />
        </label>

        <label className="template-field">
          <span className="template-label">The title a new note gets</span>
          <input
            className="add-note"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="{date} 1-1"
          />
          <span className="template-hint">
            {'{date}'} becomes today.{' '}
            {preview.length > 0 ? (
              <>
                A note made now would be called <strong>{preview}</strong>.
              </>
            ) : (
              <>Leave it empty and the note keeps whatever you type in the add field.</>
            )}
          </span>
        </label>

        <label className="template-field">
          <span className="template-label">When to reach for it, optional</span>
          <input
            className="add-note"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="The questions you actually want to ask, already in the note."
          />
        </label>

        <div className="modal-actions">
          <button type="button" className="modal-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-btn is-primary"
            disabled={!ready}
            onClick={() => onSave({ name: name.trim(), title: title.trim(), description: description.trim() })}
          >
            Save it
          </button>
        </div>
      </div>
    </div>
  )
}
