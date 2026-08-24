import { useCallback, useEffect, useRef, useState } from 'react'
import type { NibIndex, NoteMeta } from '@shared/types'
import { CanvasEditor } from './CanvasEditor'
import { applyBlockShortcut, applyDividerShortcut, applyInlineShortcut } from '../lib/markdown'
import { SlashMenu, matchCommands } from './SlashMenu'
import type { SlashCommand } from './SlashMenu'
import {
  applyCanvasBlocks,
  applyImageWidths,
  normaliseBlocks,
  normaliseLists,
  blockAtSelection,
  bodyHasDrawing,
  bodyHasImage,
  buildPreview,
  deriveTitle,
  extractAlerts,
  imageWidth,
  newId,
  noteTrail,
  relativeTime,
  sanitizeHtml,
  wordCount
} from '../lib/notes'

/** How long after the last keystroke the note is written to disk. */
const SAVE_DELAY = 600

/**
 * The strip of margin to the left of every line, where its alert marker is drawn
 * and where a click on that marker lands. In the margin rather than inside the
 * line, so showing the marker on hover cannot shift the text sideways.
 */
const ALERT_GUTTER = 26

/** The lines that can carry an alert - kept in step with ALERT_BLOCKS in notes.ts. */
const ALERT_LINES = 'p, h1, h2, h3, h4, li, blockquote'

interface EditorProps {
  index: NibIndex
  note: NoteMeta | null
  /** Measure - the editor column width, adjustable per the design spec. */
  measure: number
  /** An alert to scroll to and flash once the note is loaded. */
  focusAlertId: string | null
  onAlertFocused: () => void
  onSaved: (noteId: string, patch: Partial<NoteMeta>) => void
  onTogglePin: (note: NoteMeta) => void
  onCycleFlag: (note: NoteMeta) => void
}

type SaveState = 'saved' | 'dirty' | 'saving'

export function Editor({
  index,
  note,
  measure,
  focusAlertId,
  onAlertFocused,
  onSaved,
  onTogglePin,
  onCycleFlag
}: EditorProps): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [words, setWords] = useState(0)
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null)
  // The drawing currently open over the document, if any.
  const [openDrawingId, setOpenDrawingId] = useState<string | null>(null)
  /*
   * The slash menu, when it is up.
   *
   * `query` is read back out of the document on every keystroke rather than
   * accumulated here, so backspacing over the query narrows the menu again and
   * deleting the slash itself closes it - no second copy of the text to keep in
   * step.
   */
  const [slash, setSlash] = useState<{
    at: { left: number; top: number }
    query: string
    active: number
  } | null>(null)
  const saveTimer = useRef<number | null>(null)
  // The note the body element currently holds, so a save that lands after a
  // switch can never write one note's text into another note's file.
  const loadedId = useRef<string | null>(null)
  // The `edited` stamp of what is currently in the body. Anything newer on disk
  // came from somewhere else - this note's sticky window, or another machine.
  const loadedEdited = useRef(0)
  // The last selection that was inside the body. See `withSelection`.
  const savedRange = useRef<Range | null>(null)
  /*
   * The title as typed, kept in a ref as well as in state.
   *
   * The state is what renders; this is what saves. A debounced save captures the
   * closure it was scheduled from, and that closure holds the title from BEFORE
   * the keystroke that scheduled it - so the file ended up one character behind
   * whatever was on screen, every time. Reading the ref makes the save see the
   * present. The body never had the problem: it is read from the DOM.
   */
  const titleRef = useRef('')

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
    const typed = titleRef.current.trim()
    const resolvedTitle = typed.length > 0 ? typed : deriveTitle(html)

    const edited = await window.nib.writeNote({
      id: note.id,
      categoryId: note.categoryId,
      subId: note.subId,
      title: resolvedTitle,
      html,
      created: note.created,
      edited: Date.now()
    })

    loadedEdited.current = edited
    onSaved(note.id, {
      title: resolvedTitle,
      preview: buildPreview(html),
      edited,
      hasImage: bodyHasImage(html),
      hasDrawing: bodyHasDrawing(html),
      alerts: extractAlerts(html)
    })
    setSaveState('saved')
    // No `title` in the dependencies on purpose: the ref carries it, and a new
    // save closure per keystroke is what re-scheduled the stale one.
  }, [note, onSaved])

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
    setSlash(null)

    void window.nib.readNote(note.id).then((doc) => {
      if (cancelled || bodyRef.current === null) {
        return
      }
      const html = sanitizeHtml(doc?.html ?? '')
      bodyRef.current.innerHTML = html
      applyImageWidths(bodyRef.current)
      applyCanvasBlocks(bodyRef.current)
      normaliseBlocks(bodyRef.current)
      normaliseLists(bodyRef.current)
      const loadedTitle = doc?.title ?? note.title
      titleRef.current = loadedTitle
      setTitle(loadedTitle)
      setWords(wordCount(html))
      setSaveState('saved')
      loadedEdited.current = doc?.edited ?? note.edited
    })

    return () => {
      cancelled = true
    }
  }, [note?.id])

  /**
   * Pick up an edit made to this same note somewhere else - its sticky window,
   * or another machine's sync - so the two views do not drift and then overwrite
   * each other.
   *
   * Only while this body is clean and unfocused. Replacing the text under a
   * caret that is mid-sentence would be worse than showing it a moment late, and
   * a body with unsaved changes must not lose them to a reload.
   */
  useEffect(() => {
    const element = bodyRef.current
    if (
      note === null ||
      element === null ||
      saveState !== 'saved' ||
      note.edited <= loadedEdited.current ||
      document.activeElement === element
    ) {
      return
    }
    let cancelled = false
    void window.nib.readNote(note.id).then((doc) => {
      if (cancelled || bodyRef.current === null || doc === null) {
        return
      }
      const html = sanitizeHtml(doc.html)
      bodyRef.current.innerHTML = html
      applyImageWidths(bodyRef.current)
      applyCanvasBlocks(bodyRef.current)
      normaliseBlocks(bodyRef.current)
      normaliseLists(bodyRef.current)
      titleRef.current = doc.title
      setTitle(doc.title)
      setWords(wordCount(html))
      loadedEdited.current = doc.edited
    })
    return () => {
      cancelled = true
    }
  }, [note?.id, note?.edited, saveState])

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

  /**
   * Remember where the caret was.
   *
   * Every toolbar button also swallows its mousedown so focus never leaves the
   * body in the first place - that alone is what fixes the formatting buttons,
   * which did nothing because by the time the click arrived there was no
   * selection left to format. This is the belt to that braces: if the selection
   * has moved out anyway (the title field, another pane), the last one inside
   * the body is restored before the command runs.
   */
  useEffect(() => {
    const remember = (): void => {
      const root = bodyRef.current
      const selection = window.getSelection()
      if (root === null || selection === null || selection.rangeCount === 0) {
        return
      }
      const range = selection.getRangeAt(0)
      if (root.contains(range.commonAncestorContainer)) {
        savedRange.current = range.cloneRange()
      }
    }
    document.addEventListener('selectionchange', remember)
    return () => {
      document.removeEventListener('selectionchange', remember)
    }
  }, [])

  /** Run something with the caret guaranteed to be back inside the body. */
  const withSelection = useCallback((run: () => void) => {
    const root = bodyRef.current
    if (root === null) {
      return
    }
    const selection = window.getSelection()
    const inside =
      selection !== null &&
      selection.rangeCount > 0 &&
      root.contains(selection.getRangeAt(0).commonAncestorContainer)

    if (!inside) {
      root.focus()
      const range = savedRange.current
      if (range !== null && root.contains(range.commonAncestorContainer)) {
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    }
    run()
  }, [])

  /*
   * New lines are paragraphs, not divs.
   *
   * A document-wide switch rather than a per-element one, so it is set once.
   * Everything that asks "which line is the caret on" looks for a paragraph, a
   * heading, a list item or a quote, and a div is none of those: with Chromium's
   * default the alert marker, the markdown shortcuts and Tab all went quiet from
   * the second line of a note onwards.
   */
  useEffect(() => {
    document.execCommand('defaultParagraphSeparator', false, 'p')
  }, [])

  /** Whether the character before the caret is a space - see the slash trigger. */
  const endsWithSpace = useCallback((): boolean => {
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0) {
      return false
    }
    const range = selection.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) {
      return false
    }
    const before = (node.textContent ?? '').slice(0, range.startOffset)
    return before.length === 0 || before.endsWith(' ')
  }, [])

  /** Where the caret is on screen, for hanging the slash menu off. */
  const caretPoint = useCallback((): { left: number; top: number } | null => {
    const selection = window.getSelection()
    if (selection === null || selection.rangeCount === 0) {
      return null
    }
    const rects = selection.getRangeAt(0).getClientRects()
    const rect = rects.length > 0 ? rects[0] : selection.getRangeAt(0).getBoundingClientRect()
    return { left: rect.left, top: rect.bottom + 4 }
  }, [])

  /**
   * The text between the slash and the caret, or null when there is no live
   * slash any more.
   *
   * Read from the DOM because that is the only copy that cannot drift: a space
   * ends it, backspacing over the slash ends it, and moving the caret elsewhere
   * ends it.
   */
  const slashQuery = useCallback((): string | null => {
    const root = bodyRef.current
    const selection = window.getSelection()
    if (root === null || selection === null || selection.rangeCount === 0) {
      return null
    }
    const range = selection.getRangeAt(0)
    if (!range.collapsed || !root.contains(range.startContainer)) {
      return null
    }
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) {
      return null
    }
    const before = (node.textContent ?? '').slice(0, range.startOffset)
    const at = before.lastIndexOf('/')
    if (at === -1) {
      return null
    }
    const query = before.slice(at + 1)
    // A space closes the menu: at that point it is prose, not a command.
    return query.includes(' ') ? null : query
  }, [])

  /**
   * The markdown shortcuts listen to `beforeinput`, not to `keydown`.
   *
   * `keydown` was the first attempt and it is the wrong event: it only knows
   * about keys. Text also arrives from an IME, from dictation and from a paste,
   * and none of those press a key - so `## ` typed with a Swedish IME, or a line
   * pasted in, would silently not format. `beforeinput` fires for every one of
   * them and says what is about to be inserted.
   *
   * A native listener rather than React's synthetic `onBeforeInput`, whose
   * event does not carry `inputType` reliably across versions - and `inputType`
   * is what tells an Enter apart from a character.
   */
  useEffect(() => {
    const root = bodyRef.current
    if (root === null) {
      return
    }
    const onBeforeInput = (event: Event): void => {
      const input = event as InputEvent
      const line = blockAtSelection(root)
      let handled = false

      if (input.inputType === 'insertParagraph') {
        handled = applyDividerShortcut(root, line)
      } else if (input.data === ' ') {
        handled = applyBlockShortcut(root, line)
      } else if (input.data === '*' || input.data === '`' || input.data === '_') {
        handled = applyInlineShortcut(root, input.data)
      } else if (input.data === '/') {
        /*
         * The slash is inserted as typed - it is text until a command is picked,
         * and taking it out early would make the menu feel like it swallowed a
         * keystroke. Only opened at the start of a line or after a space, so
         * `and/or` and a path stay prose.
         */
        const line = blockAtSelection(root)
        const query = slashQuery()
        if (query === null && (line === null || line.textContent === '' || endsWithSpace())) {
          window.setTimeout(() => {
            const point = caretPoint()
            if (point !== null) {
              setSlash({ at: point, query: '', active: 0 })
            }
          }, 0)
        }
      }

      if (handled) {
        event.preventDefault()
        onBodyInput()
      }
    }
    root.addEventListener('beforeinput', onBeforeInput)
    return () => {
      root.removeEventListener('beforeinput', onBeforeInput)
    }
  })

  const onBodyInput = useCallback(() => {
    const element = bodyRef.current
    if (element !== null) {
      setWords(wordCount(element.innerHTML))
    }
    setSlash((current) => {
      if (current === null) {
        return null
      }
      const query = slashQuery()
      if (query === null) {
        return null
      }
      // The highlight goes back to the top when the matches change under it.
      return { ...current, query, active: 0 }
    })
    scheduleSave()
  }, [scheduleSave, slashQuery])

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
      withSelection(() => {
        document.execCommand(command, false, value)
        onBodyInput()
      })
    },
    [onBodyInput, withSelection]
  )

  /**
   * Flag the block the caret is in as an action point, or clear the flag.
   *
   * The flag is a data attribute on the block itself rather than a separate list
   * of positions: text moves as a note is edited, and a position would be stale
   * the moment a paragraph was inserted above it. The id is minted here, once,
   * so the alert strip can jump back to this exact block later.
   */
  const toggleAlert = useCallback(() => {
    const root = bodyRef.current
    if (root === null || note === null) {
      return
    }
    withSelection(() => {
      const block = blockAtSelection(root)
      if (block === null) {
        // No line to flag, so the note itself is the action point. A card that
        // says "call the contractor" has no line worth singling out.
        onCycleFlag(note)
        return
      }
      if (block.dataset.alert === undefined) {
        block.dataset.alert = '1'
        if (block.dataset.alertId === undefined || block.dataset.alertId.length === 0) {
          block.dataset.alertId = newId('alert')
        }
      } else {
        // Flagged already, open or done: the button clears it outright. Ticking
        // it off - keeping the mark, losing the nag - is what the checkbox does.
        delete block.dataset.alert
        delete block.dataset.alertId
      }
      onBodyInput()
    })
  }, [note, onBodyInput, onCycleFlag, withSelection])

  /**
   * The marker in a line's margin, clicked.
   *
   * One control, three states, in the order you meet them: not flagged, flagged,
   * done - and round again, so an accidental flag is one more click to undo. It
   * sits in the margin rather than in the toolbar because that is where the line
   * is; a button at the far end of a toolbar is a long way from the sentence it
   * is about.
   *
   * It is drawn by CSS, not as an element, so a click inside the marker's strip
   * of margin is what counts. A real checkbox in the document would be content:
   * selectable, deletable halfway, and visible in previews and word counts.
   */
  const cycleAlert = useCallback(
    (block: HTMLElement) => {
      const state = block.dataset.alert
      if (state === undefined) {
        block.dataset.alert = '1'
        if (block.dataset.alertId === undefined || block.dataset.alertId.length === 0) {
          block.dataset.alertId = newId('alert')
        }
      } else if (state === '1') {
        block.dataset.alert = 'done'
      } else {
        delete block.dataset.alert
        delete block.dataset.alertId
      }
      onBodyInput()
    },
    [onBodyInput]
  )

  /** Scroll to a flagged block and flash it, when arriving from the alert strip. */
  useEffect(() => {
    const root = bodyRef.current
    if (focusAlertId === null || root === null || note === null) {
      return
    }
    // The body may still be loading; retry on the next frame until it is there.
    let frames = 0
    let cancelled = false
    const look = (): void => {
      if (cancelled || bodyRef.current === null) {
        return
      }
      const target = bodyRef.current.querySelector(`[data-alert-id="${focusAlertId}"]`)
      if (target !== null) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        target.classList.add('is-flashing')
        window.setTimeout(() => target.classList.remove('is-flashing'), 1400)
        onAlertFocused()
        return
      }
      if (frames++ < 60) {
        window.requestAnimationFrame(look)
      }
    }
    window.requestAnimationFrame(look)
    return () => {
      cancelled = true
    }
  }, [focusAlertId, note?.id, onAlertFocused])

  const wrapInCode = useCallback(() => {
    const selection = window.getSelection()
    const text = selection?.toString() ?? ''
    exec('insertHTML', `<code>${text.length > 0 ? escapeHtml(text) : 'code'}</code>`)
  }, [exec])

  /**
   * Store the image in the assets folder, then reference it from the body.
   *
   * No width is set on insert: the image renders at its natural size, capped by
   * the column, so a screenshot is not upscaled into a blurry mess before anyone
   * asks for it to be bigger.
   */
  const insertImageFromDataUrl = useCallback(
    async (dataUrl: string) => {
      const url = await window.nib.writeAsset(dataUrl)
      exec('insertHTML', `<img src="${url}" alt="" />`)
    },
    [exec]
  )

  /**
   * Insert a drawing block and open it.
   *
   * A canvas is a block inside a note, the same way a pasted image is - not a
   * kind of note. The id in `data-canvas` is what ties the block to its stroke
   * file, and it is minted here so the block and the file agree from the start.
   */
  const insertCanvas = useCallback(() => {
    const root = bodyRef.current
    if (root === null) {
      return
    }
    const id = newId('drw')

    // Built with DOM calls rather than execCommand('insertHTML'). A canvas block
    // is a block element, and insertHTML dropped it when the caret sat inside a
    // paragraph - a div is not valid there, so the browser unwrapped it and left
    // the contents behind. Placing it as a sibling of that paragraph is both
    // valid and predictable.
    const block = document.createElement('div')
    block.className = 'canvas-block'
    block.dataset.canvas = id
    block.contentEditable = 'false'

    // A paragraph after it, so there is somewhere to keep typing.
    const after = document.createElement('p')
    after.appendChild(document.createElement('br'))

    const current = blockAtSelection(root)
    const anchor = current !== null && current.parentElement === root ? current : root.lastElementChild
    if (anchor === null) {
      root.appendChild(block)
    } else {
      anchor.after(block)
    }
    block.after(after)

    // Caret into the new paragraph, so the note is ready to keep writing in.
    const range = document.createRange()
    range.setStart(after, 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    onBodyInput()
    setOpenDrawingId(id)
  }, [onBodyInput])

  /**
   * Put the rendered drawing into its block once the canvas is closed.
   *
   * An empty drawing takes its block with it: opening a canvas, drawing nothing
   * and closing it should leave the note as it was, not leave a 170px hole in it.
   */
  const onDrawingDone = useCallback(
    ({ drawingId, imageUrl }: { drawingId: string; imageUrl: string }) => {
      setOpenDrawingId(null)
      const root = bodyRef.current
      const block = root?.querySelector(`[data-canvas="${drawingId}"]`)
      if (root === null || block === null || block === undefined) {
        return
      }
      if (imageUrl.length === 0) {
        block.remove()
        void window.nib.deleteDrawing(drawingId)
      } else {
        block.innerHTML = `<img src="${imageUrl}" alt="" />`
      }
      applyCanvasBlocks(root)
      onBodyInput()
    },
    [onBodyInput]
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

  /**
   * Resize or remove the selected image.
   *
   * The size goes in `data-w` and is applied as a style. See `applyImageWidths`
   * for why it is stored that way rather than as a width attribute or a style.
   */
  const resizeImage = useCallback(
    (factor: number) => {
      if (selectedImage === null) {
        return
      }
      const next = Math.max(80, Math.min(1600, Math.round(imageWidth(selectedImage) * factor)))
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

  /** Take the `/query` back out, then do what was asked. */
  const runSlashCommand = useCallback(
    (command: SlashCommand) => {
      const root = bodyRef.current
      setSlash(null)
      if (root === null) {
        return
      }
      const selection = window.getSelection()
      if (selection !== null && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0)
        const node = range.startContainer
        if (node.nodeType === Node.TEXT_NODE) {
          const before = (node.textContent ?? '').slice(0, range.startOffset)
          const at = before.lastIndexOf('/')
          if (at !== -1) {
            const cut = document.createRange()
            cut.setStart(node, at)
            cut.setEnd(node, range.startOffset)
            selection.removeAllRanges()
            selection.addRange(cut)
            document.execCommand('delete')
          }
        }
      }

      switch (command.id) {
        case 'today':
          exec('insertText', new Date().toLocaleDateString('sv-SE'))
          break
        case 'now':
          exec(
            'insertText',
            new Date().toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })
          )
          break
        case 'h1':
        case 'h2':
        case 'h3':
          exec('formatBlock', command.id)
          break
        case 'body':
          exec('formatBlock', 'p')
          break
        case 'bullets':
          exec('insertUnorderedList')
          break
        case 'numbers':
          exec('insertOrderedList')
          break
        case 'quote':
          exec('formatBlock', 'blockquote')
          break
        case 'code':
          wrapInCode()
          break
        case 'divider':
          exec('insertHorizontalRule')
          break
        case 'alert':
          toggleAlert()
          break
        case 'canvas':
          insertCanvas()
          break
        case 'image':
          pickImage()
          break
      }
    },
    [exec, insertCanvas, pickImage, toggleAlert, wrapInCode]
  )

  const onBodyKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      /*
       * Tab nests a bullet, Shift+Tab lifts it back out.
       *
       * A contenteditable does nothing useful with Tab on its own: the browser
       * treats it as "move to the next focusable thing" and the caret leaves the
       * document altogether. So Enter-then-Tab, which is how every editor makes a
       * sub-bullet, did nothing here.
       *
       * Outside a list the key is swallowed rather than passed on. There is no
       * good meaning for a tab in a note - a tab character in HTML collapses to a
       * space, and indenting a paragraph with `indent` wraps it in a blockquote,
       * which says something the author did not - and letting focus jump out of
       * the note mid-sentence is worse than nothing happening.
       */
      /*
       * While the menu is up it owns the arrows, Enter, Tab and Escape - and
       * nothing else, so typing keeps filtering it rather than being captured.
       */
      if (slash !== null) {
        const matches = matchCommands(slash.query)
        if (event.key === 'Escape') {
          event.preventDefault()
          setSlash(null)
          return
        }
        if (matches.length > 0 && (event.key === 'Enter' || event.key === 'Tab')) {
          event.preventDefault()
          runSlashCommand(matches[Math.min(slash.active, matches.length - 1)])
          return
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const step = event.key === 'ArrowDown' ? 1 : -1
          setSlash({
            ...slash,
            active: (slash.active + step + matches.length) % Math.max(1, matches.length)
          })
          return
        }
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        const root = bodyRef.current
        if (root === null) {
          return
        }
        const item = blockAtSelection(root)?.closest('li') ?? null
        if (item === null) {
          return
        }
        if (event.shiftKey) {
          exec('outdent')
          normaliseLists(root)
          return
        }
        /*
         * A bullet can only nest under the one above it.
         *
         * Chromium's `indent` does not check: on the first item of a list it
         * wraps the whole list in another list instead, which is invalid HTML
         * (a `ul` directly inside a `ul`) and renders as one indented bullet
         * that has swallowed its siblings. So the first item stays put.
         */
        if (item.previousElementSibling?.tagName === 'LI') {
          exec('indent')
          normaliseLists(root)
        }
        return
      }
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault()
        void save()
        return
      }
      // Matched on `code`, not `key`: on a Swedish layout Shift+8 produces '(',
      // not '*', so keying off the character would make the shortcut disappear on
      // the author's own keyboard.
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyA') {
        event.preventDefault()
        toggleAlert()
        return
      }
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
    [exec, onBodyInput, removeImage, runSlashCommand, save, selectedImage, slash, toggleAlert]
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
      {/* Mousedown is swallowed for the buttons, so pressing one never takes
          focus - and with it the selection - out of the document. Without this
          the formatting buttons did nothing at all. */}
      <div
        className="toolbar"
        onMouseDown={(event) => {
          if ((event.target as HTMLElement).closest('button') !== null) {
            event.preventDefault()
          }
        }}
      >
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
          <button type="button" onClick={insertCanvas}>Canvas</button>
        </div>
        </div>

        <div className="toolbar-right">
          {/* Outside the scrolling half on purpose: the formatting buttons can
              scroll out of reach on a narrow panel, this must not. */}
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

      {openDrawingId !== null && (
        <CanvasEditor
          drawingId={openDrawingId}
          onDone={onDrawingDone}
          onCancel={() => setOpenDrawingId(null)}
        />
      )}

      {/* Hidden rather than unmounted while the canvas is open: the body element
          is where the note lives, and a save that lands meanwhile must still find
          it. */}
      <div
        className={`document${openDrawingId !== null ? ' is-hidden' : ''}`}
        style={{ maxWidth: measure }}
      >
        <input
          className="doc-title"
          placeholder="Untitled"
          value={title}
          onChange={(event) => {
            titleRef.current = event.target.value
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
          {/* Both scopes, not just Private. A note in a Work category was
              unmarked, which read as "no scope" rather than "work". */}
          {category?.scope === 'P' && <span className="tag tag-private">private</span>}
          {category?.scope === 'W' && <span className="tag tag-work">work</span>}
          {/* The editor shows one note whatever list it came from, so this is
              where being archived is ambiguous - and where "why is this not in
              my category" gets its answer. The Archive list needs no such tag:
              every card in it is archived. */}
          {note.archived && <span className="tag tag-archived">archived</span>}
        </div>

        {slash !== null && (
          <SlashMenu
            at={slash.at}
            query={slash.query}
            active={slash.active}
            onPick={runSlashCommand}
            onHover={(index) => setSlash({ ...slash, active: index })}
          />
        )}

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

            // The marker column: flag this line, tick it off, or clear it. The
            // click lands on the body's padding rather than on any line, so the
            // line is the one the pointer is level with.
            const body = bodyRef.current
            if (body !== null && event.clientX - body.getBoundingClientRect().left <= ALERT_GUTTER) {
              const line = Array.from(body.querySelectorAll<HTMLElement>(ALERT_LINES)).find(
                (candidate) => {
                  const box = candidate.getBoundingClientRect()
                  return event.clientY >= box.top && event.clientY <= box.bottom
                }
              )
              if (line !== undefined) {
                cycleAlert(line)
                return
              }
            }

            // A click anywhere in a drawing block opens the drawing, image and
            // label alike, which is what "click to open" promises.
            const canvas = target.closest('[data-canvas]')
            if (canvas !== null) {
              const id = (canvas as HTMLElement).dataset.canvas
              if (id !== undefined && id.length > 0) {
                setSelectedImage(null)
                setOpenDrawingId(id)
                return
              }
            }
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
