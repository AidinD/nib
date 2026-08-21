import { useCallback, useEffect, useRef, useState } from 'react'
import type { NibIndex, NoteMeta } from '@shared/types'
import {
  bodyHasDrawing,
  bodyHasImage,
  buildPreview,
  deriveTitle,
  noteTrail,
  relativeTime,
  sanitizeHtml,
  wordCount
} from '../lib/notes'

/** How long after the last keystroke the note is written to disk. */
const SAVE_DELAY = 600

interface EditorProps {
  index: NibIndex
  note: NoteMeta | null
  /** Measure - the editor column width, adjustable per the design spec. */
  measure: number
  onSaved: (noteId: string, patch: Partial<NoteMeta>) => void
  onTogglePin: (note: NoteMeta) => void
}

type SaveState = 'saved' | 'dirty' | 'saving'

export function Editor({ index, note, measure, onSaved, onTogglePin }: EditorProps): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [words, setWords] = useState(0)
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null)
  const saveTimer = useRef<number | null>(null)
  // The note the body element currently holds, so a save that lands after a
  // switch can never write one note's text into another note's file.
  const loadedId = useRef<string | null>(null)

  const category = index.categories.find((c) => c.id === note?.categoryId)

  const save = useCallback(async () => {
    const element = bodyRef.current
    if (note === null || element === null || loadedId.current !== note.id) {
      return
    }
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }

    setSaveState('saving')
    const html = sanitizeHtml(element.innerHTML)
    const resolvedTitle = title.trim().length > 0 ? title.trim() : deriveTitle(html)

    const edited = await window.nib.writeNote({
      id: note.id,
      categoryId: note.categoryId,
      subId: note.subId,
      title: resolvedTitle,
      html,
      created: note.created,
      edited: Date.now()
    })

    onSaved(note.id, {
      title: resolvedTitle,
      preview: buildPreview(html),
      edited,
      hasImage: bodyHasImage(html),
      hasDrawing: bodyHasDrawing(html)
    })
    setSaveState('saved')
  }, [note, onSaved, title])

  /** Load the note body whenever the open note changes. */
  useEffect(() => {
    const element = bodyRef.current
    if (note === null || element === null) {
      loadedId.current = null
      return
    }
    let cancelled = false
    loadedId.current = note.id
    setSelectedImage(null)

    void window.nib.readNote(note.id).then((doc) => {
      if (cancelled || bodyRef.current === null) {
        return
      }
      const html = sanitizeHtml(doc?.html ?? '')
      bodyRef.current.innerHTML = html
      setTitle(doc?.title ?? note.title)
      setWords(wordCount(html))
      setSaveState('saved')
    })

    return () => {
      cancelled = true
    }
  }, [note?.id])

  /** Flush a pending save when the note changes or the window goes away. */
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current)
        void save()
      }
    }
  }, [save])

  const scheduleSave = useCallback(() => {
    setSaveState('dirty')
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
    }
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void save()
    }, SAVE_DELAY)
  }, [save])

  const onBodyInput = useCallback(() => {
    const element = bodyRef.current
    if (element !== null) {
      setWords(wordCount(element.innerHTML))
    }
    scheduleSave()
  }, [scheduleSave])

  /**
   * Rich text through the browser's own editing commands.
   *
   * `document.execCommand` is deprecated and its replacement is not shipping, so
   * every contenteditable editor either uses it or ships a whole editing engine.
   * For a local notes app the trade is worth it; the moment it stops working, the
   * fallback is a real editor library, not a hand-rolled selection model.
   */
  const exec = useCallback(
    (command: string, value?: string) => {
      bodyRef.current?.focus()
      document.execCommand(command, false, value)
      onBodyInput()
    },
    [onBodyInput]
  )

  const wrapInCode = useCallback(() => {
    const selection = window.getSelection()
    const text = selection?.toString() ?? ''
    exec('insertHTML', `<code>${text.length > 0 ? escapeHtml(text) : 'code'}</code>`)
  }, [exec])

  /** Store the image in the assets folder, then reference it from the body. */
  const insertImageFromDataUrl = useCallback(
    async (dataUrl: string) => {
      const url = await window.nib.writeAsset(dataUrl)
      exec('insertHTML', `<img src="${url}" alt="" data-w="480" style="width:480px" />`)
    },
    [exec]
  )

  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const image = Array.from(event.clipboardData.items).find((item) =>
        item.type.startsWith('image/')
      )
      if (image === undefined) {
        // Plain HTML paste, sanitised rather than trusted - a paste from a browser
        // otherwise brings scripts, inline styles and remote images with it.
        const html = event.clipboardData.getData('text/html')
        if (html.length > 0) {
          event.preventDefault()
          exec('insertHTML', sanitizeHtml(html))
        }
        return
      }
      const file = image.getAsFile()
      if (file === null) {
        return
      }
      event.preventDefault()
      const reader = new FileReader()
      reader.onload = () => {
        void insertImageFromDataUrl(String(reader.result))
      }
      reader.readAsDataURL(file)
    },
    [exec, insertImageFromDataUrl]
  )

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const file = Array.from(event.dataTransfer.files).find((f) => f.type.startsWith('image/'))
      if (file === undefined) {
        return
      }
      event.preventDefault()
      const reader = new FileReader()
      reader.onload = () => {
        void insertImageFromDataUrl(String(reader.result))
      }
      reader.readAsDataURL(file)
    },
    [insertImageFromDataUrl]
  )

  const pickImage = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file === undefined) {
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        void insertImageFromDataUrl(String(reader.result))
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }, [insertImageFromDataUrl])

  /** Resize or remove the selected image. */
  const resizeImage = useCallback(
    (factor: number) => {
      if (selectedImage === null) {
        return
      }
      const current = Number(selectedImage.dataset.w ?? selectedImage.width ?? 480)
      const next = Math.max(80, Math.min(1200, Math.round(current * factor)))
      selectedImage.dataset.w = String(next)
      selectedImage.style.width = `${next}px`
      onBodyInput()
    },
    [onBodyInput, selectedImage]
  )

  const removeImage = useCallback(() => {
    selectedImage?.remove()
    setSelectedImage(null)
    onBodyInput()
  }, [onBodyInput, selectedImage])

  const onBodyKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault()
        void save()
        return
      }
      // Matched on `code`, not `key`: on a Swedish layout Shift+8 produces '(',
      // not '*', so keying off the character would make the shortcut disappear on
      // the author's own keyboard.
      if (event.ctrlKey && event.shiftKey && event.code === 'Digit8') {
        event.preventDefault()
        exec('insertUnorderedList')
        return
      }
      if (selectedImage !== null && (event.key === 'Backspace' || event.key === 'Delete')) {
        event.preventDefault()
        removeImage()
        return
      }
      if (event.key === 'Escape') {
        setSelectedImage(null)
      }
    },
    [exec, removeImage, save, selectedImage]
  )

  if (note === null) {
    return (
      <section className="editor">
        <p className="empty">Pick a note, or add one.</p>
      </section>
    )
  }

  return (
    <section className="editor">
      <div className="toolbar">
        {/* The formatting groups scroll when the panel is narrow; the save state
            and the sticky toggle sit outside that, so they can never be the part
            that gets clipped. */}
        <div className="toolbar-scroll">
        <div className="toolbar-group">
          <button type="button" onClick={() => exec('formatBlock', 'h1')}>H1</button>
          <button type="button" onClick={() => exec('formatBlock', 'h2')}>H2</button>
          <button type="button" onClick={() => exec('formatBlock', 'h3')}>H3</button>
          <button type="button" onClick={() => exec('formatBlock', 'p')}>Body</button>
        </div>
        <div className="toolbar-group">
          <button type="button" onClick={() => exec('bold')}><b>B</b></button>
          <button type="button" onClick={() => exec('italic')}><i>I</i></button>
          <button type="button" onClick={() => exec('underline')}><u>U</u></button>
          <button type="button" onClick={() => exec('strikeThrough')}><s>S</s></button>
          <button type="button" onClick={wrapInCode}>code</button>
        </div>
        <div className="toolbar-group">
          <button type="button" onClick={() => exec('insertUnorderedList')}>Bullets</button>
          <button type="button" onClick={() => exec('insertOrderedList')}>1. List</button>
          <button type="button" onClick={() => exec('formatBlock', 'blockquote')}>Quote</button>
          <button type="button" onClick={() => exec('insertHorizontalRule')}>Divider</button>
        </div>
        <div className="toolbar-group">
          <button type="button" onClick={pickImage}>Image</button>
        </div>
        </div>

        <div className="toolbar-right">
          <span className={`save-state${saveState === 'saved' ? '' : ' is-pending'}`}>
            {saveState === 'saved' ? 'Saved' : 'Saving…'}
          </span>
          <button
            type="button"
            className={note.pinned ? 'is-active' : ''}
            onClick={() => onTogglePin(note)}
          >
            {note.pinned ? 'Sticky' : 'Pin as sticky'}
          </button>
        </div>
      </div>

      <div className="document" style={{ maxWidth: measure }}>
        <input
          className="doc-title"
          placeholder="Untitled"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            scheduleSave()
          }}
        />
        <div className="doc-meta">
          <span>{noteTrail(index.categories, note)}</span>
          <span>
            {words} {words === 1 ? 'word' : 'words'}
          </span>
          <span>edited {relativeTime(note.edited)}</span>
          {category?.scope === 'P' && <span className="tag">private</span>}
        </div>

        {selectedImage !== null && (
          <div className="image-toolbar">
            <button type="button" onClick={() => resizeImage(0.8)}>Smaller</button>
            <button type="button" onClick={() => resizeImage(1.25)}>Larger</button>
            <button type="button" className="danger" onClick={removeImage}>Remove</button>
          </div>
        )}

        <div
          ref={bodyRef}
          className="doc-body"
          contentEditable
          suppressContentEditableWarning
          spellCheck
          onInput={onBodyInput}
          onKeyDown={onBodyKeyDown}
          onPaste={onPaste}
          onDrop={onDrop}
          onBlur={() => {
            if (saveState !== 'saved') {
              void save()
            }
          }}
          onClick={(event) => {
            const target = event.target as HTMLElement
            setSelectedImage(target.tagName === 'IMG' ? (target as HTMLImageElement) : null)
          }}
        />
      </div>
    </section>
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
