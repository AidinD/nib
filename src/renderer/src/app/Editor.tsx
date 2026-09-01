import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NibIndex, NoteMeta } from '@shared/types'
import { CanvasEditor } from './CanvasEditor'
import { ConfirmModal } from './ConfirmModal'
import { applyBlockShortcut, applyDividerShortcut, applyInlineShortcut, insertDivider } from '../lib/markdown'
import { DatePicker, formatDate, shiftDate } from './DatePicker'
import { NotePicker, listNotes } from './NotePicker'
import { RecordPanel, RecordingBar } from './RecordPanel'
import { SummaryPanel, SUMMARY_MODELS } from './SummaryPanel'
import type { SummarySource } from './SummaryPanel'
import type { Language } from './RecordPanel'
import type { Recorder } from '../lib/recorder'
import type { NoteChoice } from './NotePicker'
import { SlashMenu, matchCommands } from './SlashMenu'
import type { SlashCommand } from './SlashMenu'
import {
  applyCanvasBlocks,
  clock,
  lineSeconds,
  applyRecordingBlocks,
  applySummaryBlocks,
  applyTimeMarks,
  applyTranscriptBlocks,
  transcriptHtml,
  transcriptForRecording,
  transcriptLineAt,
  transcriptSpeakers,
  transcriptsWithMarks,
  summaryHtml,
  ownNotes,
  htmlToText,
  applyImageWidths,
  applyNoteLinks,
  noteLinkHtml,
  noteTitles,
  normaliseBlocks,
  leaveEmptyItem,
  normaliseLists,
  blockAtSelection,
  bodyHasDrawing,
  bodyHasImage,
  buildPreview,
  deriveTitle,
  extractAlerts,
  extractLinks,
  imageWidth,
  newId,
  noteTrail,
  placeRecording,
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
/*
 * How far into the margin a click still means "flag this line".
 *
 * Narrower than the gutter itself, which is 26px: the flag is drawn between 2 and
 * 18, and the six pixels immediately left of the text are where you click to put
 * the caret at the start of a line. Those six used to toggle an action point, so
 * a normal click in a normal place quietly flagged something - which is how this
 * notebook came to have three or four nobody meant to set.
 */
const ALERT_GUTTER = 20

/** The lines that can carry an alert - kept in step with ALERT_BLOCKS in notes.ts. */
/*
 * Which model writes the summary.
 *
 * Haiku, because compressing a transcript into a fixed structure is extraction
 * rather than reasoning, and the difference between tiers barely shows. Where a
 * larger model earns its cost is reading between the lines - an implied promise,
 * what a disagreement was actually about - so this is the one line to change when
 * a meeting is worth more than the default.
 */
const SUMMARY_MODEL = 'claude-haiku-4-5'

const ALERT_LINES = 'p, h1, h2, h3, h4, li, blockquote'

interface EditorProps {
  index: NibIndex
  note: NoteMeta | null
  /** Measure - the editor column width, adjustable per the design spec. */
  measure: number
  /** Whether the "mentioned in" list under the note is expanded. */
  mentionsOpen: boolean
  /** Flip that, for every note - it is a reading preference, not a note's state. */
  onToggleMentions: () => void
  /** An alert to scroll to and flash once the note is loaded. */
  focusAlertId: string | null
  onAlertFocused: () => void
  onSaved: (noteId: string, patch: Partial<NoteMeta>) => void
  onTogglePin: (note: NoteMeta) => void
  onCycleFlag: (note: NoteMeta) => void
  /** Follow a link to another note - the list and the sidebar go there too. */
  onOpenNote: (noteId: string) => void
}

type SaveState = 'saved' | 'dirty' | 'saving'

export function Editor({
  index,
  note,
  measure,
  mentionsOpen,
  onToggleMentions,
  focusAlertId,
  onAlertFocused,
  onSaved,
  onTogglePin,
  onCycleFlag,
  onOpenNote
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
  /*
   * The date picker, when it is up.
   *
   * The highlighted day lives here rather than in the component for the same
   * reason the slash menu's does: the picker takes no focus, so the arrow keys
   * arrive at the document and are routed on from the editor's key handler.
   */
  const [picker, setPicker] = useState<{
    at: { left: number; top: number }
    cursor: Date
  } | null>(null)
  /*
   * Recording a meeting into this note.
   *
   * `panel` is the pre-flight - language and levels - and `recording` is the run
   * itself. They are separate because the first can be cancelled and the second
   * cannot: once audio is being captured, closing a panel must not quietly throw
   * a meeting away.
   */
  const [panel, setPanel] = useState(false)
  const [summarising, setSummarising] = useState(false)

  /** The transcript waiting on a yes - held by element, since it is about to go. */
  const [pendingDrop, setPendingDrop] = useState<HTMLElement | null>(null)
  /** The recording whose audio is waiting on a yes. Held the same way, and for a
   *  worse reason: the file is about to leave the disk, where undo cannot reach. */
  const [pendingAudioDrop, setPendingAudioDrop] = useState<HTMLElement | null>(null)
  const [pendingTrim, setPendingTrim] = useState<HTMLElement | null>(null)
  const [summaryPanel, setSummaryPanel] = useState(false)
  /** Which tier to use. Per note rather than a setting: it is a judgement about
   *  this meeting, not a preference about all of them. */
  const [summaryModel, setSummaryModel] = useState<string>(SUMMARY_MODELS[0].id)
  /** How many transcripts the note holds - what the panel offers depends on it. */
  const [transcriptCount, setTranscriptCount] = useState(0)
  /*
   * The last transcript removed, and where it was.
   *
   * A ref rather than state: putting it back is a DOM operation and nothing on
   * screen renders from it. Cleared by the next edit, so this can never be the
   * answer to a Ctrl+Z that meant something else.
   */
  const undone = useRef<{
    node: HTMLElement
    parent: HTMLElement | null
    before: ChildNode | null
  } | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [recording, setRecording] = useState<{ recorder: Recorder; language: Language } | null>(
    null
  )

  /*
   * The note picker, when `/link` is up.
   *
   * `spaced` is decided when the picker OPENS, while the caret is still in the
   * document - by the time a note has been chosen, focus is in the picker's own
   * search field and the document's selection says nothing useful.
   */
  const [linker, setLinker] = useState<{
    at: { left: number; top: number }
    spaced: boolean
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
      alerts: extractAlerts(html),
      links: extractLinks(html)
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
    setPicker(null)
    setLinker(null)
    setSummaryError(null)

    void window.nib.readNote(note.id).then((doc) => {
      if (cancelled || bodyRef.current === null) {
        return
      }
      const html = sanitizeHtml(doc?.html ?? '')
      bodyRef.current.innerHTML = html
      applyImageWidths(bodyRef.current)
      applyCanvasBlocks(bodyRef.current)
      applyRecordingBlocks(bodyRef.current)
      applyTranscriptBlocks(bodyRef.current)
      applyTimeMarks(bodyRef.current)
      applySummaryBlocks(bodyRef.current)
      void markLostRecordings(bodyRef.current)
      normaliseBlocks(bodyRef.current)
      normaliseLists(bodyRef.current)
      applyNoteLinks(bodyRef.current, noteTitles(index))
      setTranscriptCount(bodyRef.current.querySelectorAll('[data-transcript]').length)
      const loadedTitle = doc?.title ?? note.title
      titleRef.current = loadedTitle
      setTitle(loadedTitle)
      setWords(wordCount(html))
      setSaveState('saved')
      loadedEdited.current = doc?.edited ?? note.edited

      /*
       * The index's list of action points is corrected against the body.
       *
       * The body is the truth: the marker is an attribute on a line, and the
       * index's copy is derived from it on save. They can drift - a note whose
       * last flag was cleared and whose index write did not land keeps a row for
       * an action point that no longer exists anywhere in the text. It then shows
       * up under "Needs you" with nothing to find, which is the worst kind of
       * reminder: one you cannot answer.
       *
       * Only the metadata is written, never the body, and only when they actually
       * differ - so opening a note is not an edit and `edited` does not move.
       */
      const inBody = extractAlerts(html)
      if (JSON.stringify(inBody) !== JSON.stringify(note.alerts)) {
        onSaved(note.id, { alerts: inBody })
      }
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
      applyRecordingBlocks(bodyRef.current)
      applyTranscriptBlocks(bodyRef.current)
      applyTimeMarks(bodyRef.current)
      applySummaryBlocks(bodyRef.current)
      void markLostRecordings(bodyRef.current)
      normaliseBlocks(bodyRef.current)
      normaliseLists(bodyRef.current)
      applyNoteLinks(bodyRef.current, noteTitles(index))
      setTranscriptCount(bodyRef.current.querySelectorAll('[data-transcript]').length)
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
    /*
     * A non-breaking space counts.
     *
     * A contenteditable stores the space at the END of a line as `&nbsp;` -
     * an ordinary space there would collapse and the line would lose its width.
     * So `endsWith(' ')` was false for exactly the case this is for: typing
     * `Deadline: /` and expecting the menu. It opened at the start of a line and
     * nowhere else, which read as the menu being unreliable.
     */
    return before.length === 0 || /[\s\u00a0]$/.test(before)
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
    // A space closes the menu: at that point it is prose, not a command. Either
    // kind of space - see the note on `&nbsp;` above.
    return /[\s\u00a0]/.test(query) ? null : query
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
      // A real edit means the browser's undo stack now holds something newer
      // than our removed transcript, so the key belongs to it again.
      undone.current = null
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
    // Typing means the calendar is not what is wanted after all; a stale one
    // hanging by the caret is worse than no calendar.
    setPicker(null)
    if (element !== null) {
      setTranscriptCount(element.querySelectorAll('[data-transcript]').length)
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
        /*
         * A line with no words cannot be flagged.
         *
         * It could, and the result was a ghost: the marker is hidden on an empty
         * line - a flag beside nothing is clutter - so the flag was invisible in
         * the note and visible only as a chip in the strip, saying "flagged line,
         * no text" and leading back to a line with nothing on it. Two of those
         * were created here by accident before this line existed.
         *
         * Clearing an existing flag is still allowed on an empty line, since a
         * line can be emptied after it was flagged and that one must stay
         * reachable.
         */
        if ((block.textContent ?? '').trim().length === 0) {
          return
        }
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
   *
   * Pasted DURING a meeting it also gets a time on it, and that is the whole
   * feature: you paste the thing being discussed while it is being discussed, and
   * the note remembers which minute that was. `recorder.seconds()` counts samples
   * rather than wall clock, so it cannot drift from the file it points into - and
   * nothing at all is written into the audio, which is the one artefact here that
   * cannot be made a second time.
   *
   * Built as an element and inserted as its own `outerHTML` rather than assembled
   * from a template string: a recording's path is a Windows path going into an
   * attribute, and letting the DOM do the quoting is cheaper than remembering
   * which characters need it.
   */
  const insertImageFromDataUrl = useCallback(
    async (dataUrl: string) => {
      const url = await window.nib.writeAsset(dataUrl)
      const image = document.createElement('img')
      image.src = url
      image.alt = ''
      if (recording !== null) {
        image.dataset.at = String(recording.recorder.seconds())
        image.dataset.rec = recording.recorder.path
      }
      exec('insertHTML', image.outerHTML)
      if (bodyRef.current !== null) {
        applyTimeMarks(bodyRef.current)
      }
    },
    [exec, recording]
  )

  /**
   * Insert a drawing block and open it.
   *
   * A canvas is a block inside a note, the same way a pasted image is - not a
   * kind of note. The id in `data-canvas` is what ties the block to its stroke
   * file, and it is minted here so the block and the file agree from the start.
   */
  /**
   * Put the finished recording into the note, as a block.
   *
   * Built with DOM calls and placed by `placeRecording` rather than at the caret:
   * a meeting was just recorded, so the caret is wherever you were typing during
   * it, and dropping a block into the middle of the sentence you were writing is
   * not what "stop" should mean. Where it goes instead - the top, under a summary,
   * after any earlier recording - and why, is written there.
   */
  const insertRecordingBlock = useCallback(
    (path: string, seconds: number, language: Language) => {
      const root = bodyRef.current
      if (root === null) {
        return
      }
      const block = document.createElement('div')
      block.dataset.recording = path
      block.dataset.seconds = String(seconds)
      block.dataset.language = language
      block.dataset.state = 'recorded'
      const last = placeRecording(root, block)
      if (last) {
        // Somewhere to type, but only when the block is the end of the note -
        // otherwise this is a blank line shoved above whatever was already there.
        const after = document.createElement('p')
        after.appendChild(document.createElement('br'))
        root.appendChild(after)
      }
      applyRecordingBlocks(root)
      onBodyInput()
      /*
       * Scroll it into view, minimally.
       *
       * At the end of the note the block appeared next to where you had been
       * typing, so stopping showed you the result. At the top it can be off
       * screen, and the block is the only place the offers to transcribe or to
       * cut live - a control that appears where you cannot see it is a control
       * you do not know you have. `nearest` does nothing when it is already
       * visible, so this does not yank the view around for its own sake.
       */
      block.scrollIntoView({ block: 'nearest' })

      /*
       * Ask the file whether the call ended before the recording did.
       *
       * After the block is in the note rather than before, because the answer is
       * an offer on it and the block should not wait on a scan of two hundred
       * megabytes to appear. It takes a fraction of a second and it may equally
       * find nothing, which is the ordinary case.
       */
      void window.nib
        .recordingCallEnd(path)
        .then((found) => {
          if (found === null || !root.isConnected || !root.contains(block)) {
            return
          }
          block.dataset.callEnd = String(found.endsAt)
          applyRecordingBlocks(root)
          onBodyInput()
        })
        .catch(() => undefined)
    },
    [onBodyInput]
  )

  /**
   * Turn a recording into text, in place.
   *
   * The block reports its own progress rather than a dialog appearing: the work
   * belongs to that recording, and a modal over the whole note would stop you
   * writing for the several minutes this takes.
   *
   * The audio is deleted the moment the transcript is in the note. That is the
   * policy the feature was designed around - an hour of a colleague's voice is the
   * most sensitive thing this app would ever hold, and the words are what the note
   * is for.
   */
  /*
   * Nothing deletes a transcript without asking.
   *
   * `beforeinput` is the only place the browser says which range an edit is about
   * to remove - `getTargetRanges()` - so it catches Backspace, Delete, cut and a
   * drag alike, where guessing from the caret's siblings caught none of them: an
   * empty paragraph sits between the block and the text below it, so the sibling
   * check looked at the wrong element and the transcript went anyway.
   *
   * A transcript cannot be typed again and its audio is deleted the moment the
   * words are in the note, so this is the one block in the editor that gets a
   * confirmation. Answering it removes the block, and Ctrl+Z brings it back.
   */
  useEffect(() => {
    const body = bodyRef.current
    if (body === null) {
      return
    }
    const onBeforeInput = (event: InputEvent): void => {
      if (!event.inputType.startsWith('delete')) {
        return
      }
      const targets = event.getTargetRanges()
      if (targets.length === 0) {
        return
      }
      const range = document.createRange()
      range.setStart(targets[0].startContainer, targets[0].startOffset)
      range.setEnd(targets[0].endContainer, targets[0].endOffset)
      const hit = Array.from(body.querySelectorAll<HTMLElement>('[data-transcript]')).find(
        (block) => range.intersectsNode(block)
      )
      if (hit !== undefined) {
        event.preventDefault()
        setPendingDrop(hit)
      }
    }
    body.addEventListener('beforeinput', onBeforeInput)
    return () => body.removeEventListener('beforeinput', onBeforeInput)
    // Re-attached when the note changes: on the first mount there is no note
    // open, `bodyRef` is still null, and an effect that only ran then would have
    // attached nothing at all - which is exactly how this was missed the first
    // time it was written.
  }, [note])

  /*
   * Say which recordings have lost their audio, before anything is clicked.
   *
   * The audio is kept until it is discarded on purpose, but a block can still
   * outlive its file: discarded here, cleared by the startup sweep because its
   * note was thrown away, or - for every note made before this - deleted the
   * moment it was transcribed. Left alone the block still offers to transcribe,
   * and clicking it reached whisper, which answers a missing file by printing its
   * entire usage text into the note. One question per block on load is cheaper
   * than that, and honest.
   *
   * `transcribed` is checked too, and that is what migrates the old notes: their
   * audio is long gone, so they load as `lost` rather than claiming it is still
   * here and offering a second run that could never happen.
   */
  const markLostRecordings = useCallback(async (root: HTMLElement): Promise<void> => {
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-recording]')).filter(
      (block) => {
        const state = block.dataset.state ?? 'recorded'
        return state === 'recorded' || state === 'failed' || state === 'transcribed'
      }
    )
    let lost = false
    for (const block of blocks) {
      const path = block.dataset.recording
      if (path === undefined || (await window.nib.recordingExists(path))) {
        continue
      }
      block.dataset.state = 'lost'
      lost = true
    }
    if (lost) {
      applyRecordingBlocks(root)
    }
  }, [])

  /**
   * What to call the two sides of a recording.
   *
   * The far side is named after the folder the note sits in, because that is the
   * filing the person already did: a 1-1 lives under the person it is with, and
   * Tend binds those folders to people for exactly this reason. A note that sits
   * loose in a category has no such answer and gets "Dem", which is true.
   *
   * Not a guess at a voice. The label says which side of the call spoke, and the
   * name is only what this notebook calls that side - which is why getting it
   * from the filing is honest and getting it from the words would not be.
   */
  const speakerNames = useCallback((): { mine: string; theirs: string } => {
    const sub = index.categories
      .find((category) => category.id === note?.categoryId)
      ?.subs.find((candidate) => candidate.id === note?.subId)
    const theirs = sub?.name.trim() ?? ''
    return { mine: 'Jag', theirs: theirs.length > 0 ? theirs : 'Dem' }
  }, [index, note])

  const transcribeBlock = useCallback(
    async (block: HTMLElement) => {
      const root = bodyRef.current
      const path = block.dataset.recording
      if (root === null || path === undefined || block.dataset.state === 'working') {
        return
      }
      const language = block.dataset.language === 'en' ? 'en' : 'sv'
      const seconds = Number(block.dataset.seconds ?? 0)

      const status = await window.nib.transcribeStatus(language)
      if (!status.ready) {
        block.dataset.state = 'failed'
        block.textContent = `Recording · could not transcribe: ${status.why ?? 'the engine is not installed'}`
        return
      }

      block.dataset.state = 'working'
      applyRecordingBlocks(root)
      const stopListening = window.nib.onTranscribeProgress((fraction) => {
        block.textContent = `Recording · transcribing… ${Math.round(fraction * 100)}%`
      })

      try {
        const result = await window.nib.transcribe({ path, language, seconds })
        stopListening()

        const holder = document.createElement('div')
        holder.innerHTML = transcriptHtml(
          result.segments,
          Math.max(1, Math.round(seconds / 60)),
          speakerNames()
        )
        const transcript = holder.firstElementChild
        if (transcript !== null) {
          /*
           * A second run replaces this block's transcript rather than stacking a
           * new one under it.
           *
           * Found in document order rather than by walking siblings, which is what
           * the first version did and what the test caught: a transcript comes back
           * from disk wrapped in a paragraph, so the block's next sibling is a `p`
           * and not the `details` inside it. Stopping at the next recording is what
           * keeps a second meeting's transcript out of it.
           */
          const inOrder = Array.from(
            root.querySelectorAll<HTMLElement>('[data-recording], [data-transcript]')
          )
          const following = inOrder[inOrder.indexOf(block) + 1]
          const previous =
            following !== undefined && following.hasAttribute('data-transcript')
              ? following
              : null
          if (previous !== null) {
            // The paragraph it was wrapped in is left behind empty otherwise, and
            // an empty paragraph is a blank line in the note.
            const holder = previous.parentElement
            previous.remove()
            if (holder !== null && holder !== root && holder.childNodes.length === 0) {
              holder.remove()
            }
          }
          block.after(transcript)
        }
        block.dataset.state = 'transcribed'
        applyRecordingBlocks(root)
        applyTranscriptBlocks(root)
        onBodyInput()

        /*
         * The audio stays on disk.
         *
         * It used to be deleted right here, the moment the words were in the note.
         * That read as tidy and made every mistake permanent: the first real
         * meeting came back about nine tenths right, names mangled, and the file
         * was already gone - so there was no way to run it again with a better
         * model, or at all. It is discarded from the block instead, once the
         * transcript has been read and believed.
         */
      } catch (error) {
        stopListening()
        const why = error instanceof Error ? error.message : String(error)
        // A missing file is not a failure to retry - the audio is not coming
        // back, and a block that keeps saying "click to transcribe" is a lie.
        if (why.includes('the audio file is gone')) {
          block.dataset.state = 'lost'
          applyRecordingBlocks(root)
          return
        }
        block.dataset.state = 'failed'
        block.textContent = `Recording · transcription failed: ${why}`
      }
    },
    [onBodyInput, speakerNames]
  )

  /**
   * Throw the audio away, on purpose.
   *
   * The block stays and becomes `lost`, which is exactly what a note from before
   * the audio was kept looks like: it still marks where the meeting was and no
   * longer offers what it cannot do. Ctrl+Z does not bring this back - the file
   * leaves the disk, not the document - which is why it is the one control here
   * that asks first.
   */
  const discardAudio = useCallback(
    async (block: HTMLElement): Promise<void> => {
      const root = bodyRef.current
      const path = block.dataset.recording
      if (root === null || path === undefined) {
        return
      }
      await window.nib.deleteRecording(path)
      block.dataset.state = 'lost'
      applyRecordingBlocks(root)
      onBodyInput()
    },
    [onBodyInput]
  )

  /**
   * Cut the recording back to where the call ended, transcript and all.
   *
   * Both halves or neither: shortening the audio and leaving the words that came
   * after it would leave the note claiming a conversation the file no longer
   * holds, and that is worse than either mistake alone. The lines go by their own
   * timestamps, which every transcript in the notebook already carries.
   *
   * The audio goes first. If the trim fails there is nothing to undo in the note;
   * if the note update failed after a successful trim the worst case is a
   * transcript longer than its audio, which the next run puts right.
   */
  const trimToCallEnd = useCallback(
    async (block: HTMLElement): Promise<void> => {
      const root = bodyRef.current
      const path = block.dataset.recording
      const endsAt = Number(block.dataset.callEnd ?? '')
      if (root === null || path === undefined || !Number.isFinite(endsAt) || endsAt <= 0) {
        return
      }
      try {
        const done = await window.nib.trimRecording(path, endsAt)
        block.dataset.seconds = String(done.seconds)
        block.removeAttribute('data-call-end')

        const transcript = transcriptForRecording(root, path)
        if (transcript !== null) {
          for (const line of Array.from(transcript.querySelectorAll<HTMLElement>('p'))) {
            const at = lineSeconds(line)
            if (at !== null && at > done.seconds) {
              line.remove()
            }
          }
          // The summary line counts what is there, so it has to be counted again.
          const label = transcript.querySelector('summary')?.firstChild ?? null
          if (label !== null && label.nodeType === Node.TEXT_NODE) {
            const left = transcript.querySelectorAll('p').length
            label.textContent = `Transkript · ${Math.max(1, Math.round(done.seconds / 60))} min · ${left} avsnitt`
          }
        }
        applyRecordingBlocks(root)
        applyTranscriptBlocks(root)
        applyTimeMarks(root)
        onBodyInput()
      } catch (error) {
        block.dataset.state = 'failed'
        block.textContent = `Recording · could not trim: ${
          error instanceof Error ? error.message : String(error)
        }`
      }
    },
    [onBodyInput]
  )

  /**
   * Pin the line being written to the minute it is being written in.
   *
   * The line the caret is already in, rather than a new one inserted below it.
   * You press this in the middle of typing "kolla varfor Q3 sag ut sa" and the
   * sentence keeps going - a button that moved the caret into a fresh block would
   * be a button you stop using in the third meeting.
   *
   * Pressing it again on the same line takes the mark off. There is no other way
   * to correct marking the wrong line, and the alternative - a mark you cannot
   * remove - is worse than no mark.
   */
  const markMoment = useCallback(() => {
    const root = bodyRef.current
    const live = recording
    if (root === null || live === null) {
      return
    }
    withSelection(() => {
      const block = blockAtSelection(root)
      // Not inside something this app generated. A timestamp on a transcript
      // line means nothing - it already has one - and one on a summary line
      // would point into the recording from the wrong end of the note.
      if (block === null || block.closest('[data-transcript], [data-recording], [data-summary]') !== null) {
        return
      }
      if (block.dataset.at !== undefined) {
        delete block.dataset.at
        delete block.dataset.rec
      } else {
        block.dataset.at = String(live.recorder.seconds())
        block.dataset.rec = live.recorder.path
      }
      applyTimeMarks(root)
      onBodyInput()
    })
  }, [onBodyInput, recording, withSelection])

  /**
   * Go from a moment to the words that were being said at it.
   *
   * The transcript is opened on the way, because a moment that scrolls a folded
   * block into view has done nothing. The line is highlighted for a second and a
   * half rather than left marked: it answers "what was said here", and a
   * transcript that accumulates highlights stops answering it.
   */
  const jumpToMoment = useCallback((owner: HTMLElement) => {
    const root = bodyRef.current
    if (root === null) {
      return
    }
    const at = Number(owner.dataset.at)
    if (!Number.isFinite(at)) {
      return
    }
    const transcript = transcriptForRecording(root, owner.dataset.rec)
    if (transcript === null) {
      // Nothing to jump to yet: the recording has not been turned into text, or
      // the note holds several and this mark cannot say which. Doing nothing is
      // the honest answer - scrolling somewhere arbitrary would not be.
      return
    }
    if (transcript instanceof HTMLDetailsElement) {
      transcript.open = true
    }
    const line = transcriptLineAt(transcript, at)
    ;(line ?? transcript).scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (line !== null) {
      line.classList.add('is-moment')
      window.setTimeout(() => line.classList.remove('is-moment'), 1500)
    }
  }, [])

  /**
   * Ask for the summary. The one thing here that costs anything.
   *
   * Everything it needs is already in the note: the transcript, and whatever was
   * typed during the meeting. The previous meeting with the same person is
   * fetched too when there is one - that is where the most useful line in the
   * answer comes from, and no transcription service can produce it, because it
   * has never seen your other notes.
   *
   * The result goes at the TOP. A summary under nine thousand words of transcript
   * is a summary nobody reads.
   */
  const summarise = useCallback(
    async (source: SummarySource, model: string) => {
    const root = bodyRef.current
    if (root === null || note === null || summarising) {
      return
    }
    /*
     * Every transcript, not the first.
     *
     * `querySelector` returns one element, and the first version used it - so a
     * note holding two recordings, which is a meeting stopped and restarted or
     * two calls in an afternoon, was summarised from half its own contents with
     * nothing to say so.
     */
    const transcripts = Array.from(root.querySelectorAll<HTMLElement>('[data-transcript]'))
    if (source === 'transcripts' && transcripts.length === 0) {
      return
    }

    setSummarising(true)
    try {
      /*
       * The last note about the same person, before this one.
       *
       * Same folder, older, and not this note - which is as close to "the
       * previous 1-1" as the notebook can answer without guessing. Its body is
       * read rather than its preview: the preview is two lines and the question
       * is what was promised.
       */
      const siblings = index.categories
        .find((category) => category.id === note.categoryId)
        ?.notes.filter(
          (candidate) =>
            candidate.subId === note.subId &&
            candidate.id !== note.id &&
            candidate.created < note.created
        )
        .sort((a, b) => b.created - a.created)
      const earlier = siblings?.[0]
      const previous =
        earlier === undefined ? undefined : (await window.nib.readNote(earlier.id))?.html

      const result = await window.nib.summarise({
        kind: source === 'transcripts' ? 'meeting' : 'note',
        /*
         * Several transcripts are one conversation as far as the summary is
         * concerned, in the order they were recorded - and each one carries the
         * moments marked while it ran, threaded in at the line they happened on.
         * A screenshot pasted at eleven minutes is a fact about the meeting that
         * the words themselves do not hold.
         */
        transcript: transcriptsWithMarks(root),
        notes: source === 'transcripts' ? ownNotes(root) : (root.textContent ?? ''),
        previous: previous === undefined ? undefined : htmlToText(previous).slice(0, 8000),
        // Only when the recording actually kept the two sides apart. Absent, the
        // model works out whose promise a line was from the words alone, the way
        // it always has.
        speakers: transcriptSpeakers(root),
        language:
          root.querySelector<HTMLElement>('[data-recording]')?.dataset.language === 'en'
            ? 'en'
            : 'sv',
        model
      })

      if (!result.ok || result.value === undefined) {
        setSummaryError(result.reason ?? 'The summary did not come back.')
        return
      }

      const holder = document.createElement('div')
      holder.innerHTML = summaryHtml(
        { model: result.model ?? model, costUsd: result.costUsd ?? null },
        result.value
      )
      const section = document.createElement('div')
      section.dataset.summary = '1'
      while (holder.firstChild !== null) {
        section.appendChild(holder.firstChild)
      }
      root.insertBefore(section, root.firstChild)
      normaliseBlocks(root)
      applySummaryBlocks(root)
      setSummaryError(null)
      onBodyInput()
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : String(error))
    } finally {
      setSummarising(false)
    }
    },
    [index, note, onBodyInput, summarising]
  )

  /**
   * Remove a transcript, and keep one step of undo for it.
   *
   * The first attempt went through `execCommand` so the browser's own undo stack
   * would carry it, which is how every other structural edit in this editor stays
   * undoable. Chromium will not do it: `delete`, `forwardDelete`, `cut`,
   * `insertHTML` and `insertText` over a selection spanning a `details` element
   * all report success and leave it exactly where it was. Measured, all five.
   *
   * So the node is taken out by hand and remembered, and Ctrl+Z puts it back -
   * once, and only while nothing else has been typed since. That last condition
   * is what keeps this from hijacking undo: the moment there is a real edit to
   * undo, the browser's stack is the right answer again and this steps aside.
   *
   * A confirmation as well. Undo is for the second after; the dialog is for the
   * second before - and where the audio has been discarded, a transcript exists
   * nowhere else.
   */
  const dropTranscript = useCallback(
    (block: HTMLElement) => {
      const root = bodyRef.current
      if (root === null) {
        return
      }
      undone.current = { node: block, parent: block.parentElement, before: block.nextSibling }
      block.remove()
      setTranscriptCount(root.querySelectorAll('[data-transcript]').length)
      onBodyInput()
    },
    [onBodyInput]
  )

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
  /**
   * A divider, and a paragraph after it.
   *
   * Not `insertHorizontalRule`: that command leaves the next line typed as a
   * bare text node under the body, belonging to no block, and the alert marker,
   * the markdown shortcuts and Tab all work by asking which block the caret is
   * in. The `---` shortcut goes to the same place.
   */
  const addDivider = useCallback(() => {
    const root = bodyRef.current
    if (root === null) {
      return
    }
    withSelection(() => {
      const line = blockAtSelection(root)
      if (line !== null && line !== root) {
        insertDivider(line)
        onBodyInput()
      }
    })
  }, [onBodyInput, withSelection])

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
          exec('insertText', formatDate(new Date()))
          break
        case 'tomorrow':
          exec('insertText', formatDate(shiftDate(new Date(), { days: 1 })))
          break
        case 'link': {
          const point = caretPoint()
          if (point !== null) {
            setLinker({ at: point, spaced: !endsWithSpace() })
          }
          break
        }
        case 'date': {
          // Opened after the query is out of the way, so the calendar hangs off
          // the caret where the date is going rather than off the slash.
          const point = caretPoint()
          if (point !== null) {
            setPicker({ at: point, cursor: new Date() })
          }
          break
        }
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
          addDivider()
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
        case 'bold':
          exec('bold')
          break
        case 'italic':
          exec('italic')
          break
        case 'strike':
          exec('strikeThrough')
          break
        case 'clear':
          exec('removeFormat')
          break
      }
    },
    [caretPoint, exec, addDivider, insertCanvas, pickImage, toggleAlert, wrapInCode]
  )

  /*
   * The notes that link to this one.
   *
   * Read from the index, which every note's links are written into on save - so
   * this is a walk over metadata already in memory, not a read of the notebook.
   * A note is never listed as mentioning itself, since a link to the note you are
   * reading tells you nothing.
   */
  const mentions = useMemo(() => {
    if (note === null) {
      return []
    }
    const found: Array<{ note: NoteMeta; trail: string }> = []
    for (const category of index.categories) {
      for (const candidate of category.notes) {
        if (candidate.id === note.id || !candidate.links.includes(note.id)) {
          continue
        }
        const sub = category.subs.find((entry) => entry.id === candidate.subId)
        found.push({
          note: candidate,
          trail: sub === undefined ? category.name : `${category.name} · ${sub.name}`
        })
      }
    }
    return found.sort((a, b) => b.note.edited - a.note.edited)
  }, [index, note])

  /** Write the chosen day where the caret was, and put the calendar away. */
  const pickDate = useCallback(
    (date: Date) => {
      setPicker(null)
      exec('insertText', formatDate(date))
    },
    [exec]
  )

  /**
   * Write the link where the caret was, with DOM calls rather than `insertHTML`.
   *
   * `insertHTML` will not be told where whitespace goes. Asked to insert a
   * non-breaking space, the link and a zero-width space, Chromium wrapped both
   * spaces in styled spans and put the leading one AFTER the link - so
   * `Se ocksa /link` came out as `Se ocksa1.1 - Kritisera inte`, with the words
   * run together and the space stranded on the far side.
   *
   * So the nodes are placed by hand: a space in front when the text does not
   * already end in one (deleting `/link` takes the space before it along, since a
   * trailing space at the end of a line collapses), and a zero-width space after,
   * so the next word typed lands outside the link instead of being swallowed into
   * its title.
   */
  const insertNoteLink = useCallback(
    (choice: NoteChoice) => {
      setLinker(null)
      withSelection(() => {
        const root = bodyRef.current
        const selection = window.getSelection()
        if (root === null || selection === null || selection.rangeCount === 0) {
          return
        }
        const range = selection.getRangeAt(0)
        if (!root.contains(range.commonAncestorContainer)) {
          return
        }
        range.deleteContents()

        /*
         * What is in front of the caret is read BEFORE anything is inserted:
         * `insertNode` splits the text node it lands in and moves the range, so
         * asking afterwards asks about a different position. One test covers both
         * kinds of space - a non-breaking space is whitespace to `\s`.
         */
        const host = range.startContainer
        const previous =
          host.nodeType === Node.TEXT_NODE && range.startOffset > 0
            ? (host.textContent ?? '').charAt(range.startOffset - 1)
            : ''
        const needsSpace = previous.length > 0 && !/\s/.test(previous)

        const anchor = document.createElement('a')
        anchor.dataset.note = choice.note.id
        anchor.textContent = choice.note.title.length > 0 ? choice.note.title : 'Untitled'

        const tail = document.createTextNode('\u200b')
        range.insertNode(tail)
        range.insertNode(anchor)
        if (needsSpace) {
          anchor.before(document.createTextNode('\u00a0'))
        }

        const after = document.createRange()
        after.setStartAfter(tail)
        after.collapse(true)
        selection.removeAllRanges()
        selection.addRange(after)
        onBodyInput()
      })
    },
    [onBodyInput, withSelection]
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
       * The calendar owns the arrows while it is up, and nothing else - so any
       * other key just goes on typing, and the calendar closes on its own once
       * the caret has moved on.
       */
      if (picker !== null) {
        const steps: Record<string, { days?: number; months?: number }> = {
          ArrowLeft: { days: -1 },
          ArrowRight: { days: 1 },
          ArrowUp: { days: -7 },
          ArrowDown: { days: 7 },
          PageUp: { months: -1 },
          PageDown: { months: 1 }
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          setPicker(null)
          return
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault()
          pickDate(picker.cursor)
          return
        }
        const step = steps[event.key]
        if (step !== undefined) {
          event.preventDefault()
          setPicker({ ...picker, cursor: shiftDate(picker.cursor, step) })
          return
        }
      }

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
      /*
       * Enter on an EMPTY bullet leaves the list, one level at a time.
       *
       * Left to Chromium this is where a nested list falls apart. Pressing Enter
       * twice in a sub-bullet did not lift the caret out of it - the sub-list was
       * moved to sit BESIDE its parent item instead, as `<li>Two</li><ul>...</ul>`,
       * which is invalid (a `ul` cannot be a child of a `ul`) and puts the caret
       * on a top-level bullet several lines from where the author was looking. The
       * next line typed then joined the list again. That is the "Enter sometimes
       * jumps to another line" - the jump was the list being rebuilt underneath it.
       *
       * The rule instead is the one every editor uses: an empty sub-bullet
       * outdents, and an empty top-level bullet becomes a paragraph after the
       * list. Nothing is restructured, so nothing moves.
       */
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
        const root = bodyRef.current
        const item = root === null ? null : (blockAtSelection(root)?.closest('li') ?? null)
        if (
          root !== null &&
          item !== null &&
          (item.textContent ?? '').trim().length === 0 &&
          item.querySelector('ul, ol') === null
        ) {
          event.preventDefault()
          leaveEmptyItem(item)
          onBodyInput()
          return
        }
      }

      /*
       * Ctrl+Z restores a transcript this app removed, when that is the most
       * recent thing that happened. Anything typed since hands the key back to
       * the browser, whose stack is then the one holding the answer.
       */
      if (event.ctrlKey && !event.shiftKey && event.key === 'z' && undone.current !== null) {
        const { node, parent, before } = undone.current
        undone.current = null
        if (parent !== null && parent.isConnected) {
          event.preventDefault()
          parent.insertBefore(node, before)
          applyTranscriptBlocks(parent)
          setTranscriptCount((count) => count + 1)
          onBodyInput()
          return
        }
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
    [
      exec,
      onBodyInput,
      picker,
      pickDate,
      removeImage,
      runSlashCommand,
      save,
      selectedImage,
      slash,
      toggleAlert
    ]
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
          <button type="button" onClick={addDivider}>Divider</button>
        </div>
        <div className="toolbar-group">
          <button type="button" onClick={pickImage}>Image</button>
          <button type="button" onClick={insertCanvas}>Canvas</button>
          {/* Recording belongs with the things you put INTO a note, not in the
              window's header: the note is the container, and its folder and tag
              are the answer to "where does this meeting go". */}
          <button
            type="button"
            className={recording !== null ? 'is-recording' : ''}
            onClick={() => setPanel((open) => !open)}
            disabled={note === null}
          >
            Record
          </button>
          {/*
            Summarising is a separate press, on purpose. Recording and
            transcribing are local and free; this is the one step that leaves the
            machine and the only one that spends anything, so it happens when you
            ask rather than because you stopped talking. It is also why it can be
            pressed again - a day later, or after editing your own notes.
          */}
          {/*
            Never disabled. It used to grey out until the note held a transcript,
            which explains nothing from the outside - a control that is grey for
            reasons it will not say teaches you only not to press it. It opens a
            panel that says what it is about to summarise and with which model.
          */}
          <button
            type="button"
            onClick={() => setSummaryPanel((open) => !open)}
            disabled={note === null || summarising}
          >
            {summarising ? 'Sammanfattar…' : 'Summarise'}
          </button>
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

        {linker !== null && (
          <NotePicker
            at={linker.at}
            choices={listNotes(index, note?.id ?? null)}
            onPick={insertNoteLink}
            onClose={() => setLinker(null)}
          />
        )}

        {pendingDrop !== null && (
          <ConfirmModal
            title="Ta bort transkriptet?"
            message={
              'Orden försvinner ur noteringen. Ctrl+Z ångrar det direkt efteråt - och ' +
              'ligger inspelningen kvar går det att transkribera om den.'
            }
            confirmLabel="Ta bort"
            onConfirm={() => {
              dropTranscript(pendingDrop)
              setPendingDrop(null)
            }}
            onCancel={() => setPendingDrop(null)}
          />
        )}

        {pendingAudioDrop !== null && (
          <ConfirmModal
            title="Släng ljudet?"
            message={
              'Transkriptet blir kvar, men inspelningen försvinner från disken och ' +
              'går inte att ångra - och då går den inte att transkribera om. Läs ' +
              'igenom transkriptet först: det är hela poängen med att ljudet ligger kvar.'
            }
            confirmLabel="Släng ljudet"
            onConfirm={() => {
              void discardAudio(pendingAudioDrop)
              setPendingAudioDrop(null)
            }}
            onCancel={() => setPendingAudioDrop(null)}
          />
        )}

        {pendingTrim !== null && (
          <ConfirmModal
            title="Klipp inspelningen?"
            message={
              `Ljudet efter ${clock(Number(pendingTrim.dataset.callEnd ?? 0))} tas bort, och med det ` +
              'raderna i transkriptet som ligger efter den punkten. Det går inte att ångra. ' +
              'Filen säger att samtalet slutade där - men det är en gissning, så läs ' +
              'transkriptet först om du är osäker.'
            }
            confirmLabel="Klipp"
            onConfirm={() => {
              void trimToCallEnd(pendingTrim)
              setPendingTrim(null)
            }}
            onCancel={() => setPendingTrim(null)}
          />
        )}

        {summaryPanel && !summarising && (
          <SummaryPanel
            transcripts={transcriptCount}
            model={summaryModel}
            onModel={setSummaryModel}
            onClose={() => setSummaryPanel(false)}
            onRun={(source) => {
              setSummaryPanel(false)
              void summarise(source, summaryModel)
            }}
          />
        )}

        {summaryError !== null && (
          <p className="summary-error">
            {summaryError}
            <button type="button" onClick={() => setSummaryError(null)}>
              Dismiss
            </button>
          </p>
        )}

        {panel && recording === null && (
          <RecordPanel
            noteId={note?.id ?? 'untitled'}
            onClose={() => setPanel(false)}
            onStarted={(recorder, language) => {
              setPanel(false)
              setRecording({ recorder, language })
            }}
          />
        )}

        {recording !== null && (
          <RecordingBar
            recorder={recording.recorder}
            onMark={markMoment}
            onStop={() => {
              const { recorder, language } = recording
              setRecording(null)
              void recorder.stop().then((done) => {
                if (done !== null) {
                  insertRecordingBlock(done.path, done.seconds, language)
                }
              })
            }}
          />
        )}

        {picker !== null && (
          <DatePicker
            at={picker.at}
            cursor={picker.cursor}
            onPick={pickDate}
            onMove={(date) => setPicker({ ...picker, cursor: date })}
          />
        )}

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
              /*
               * The last match, not the first.
               *
               * A list item that contains a sub-list is as tall as all of it, so
               * the pointer level with a sub-bullet is inside the parent item's
               * box too - and taking the first match flagged the line above
               * instead of the one clicked. Document order puts the innermost
               * item last among the matches.
               */
              const candidates = Array.from(
                body.querySelectorAll<HTMLElement>(ALERT_LINES)
              ).filter((candidate) => {
                /*
                 * Not a line of a transcript, and not the signature.
                 *
                 * A transcript's paragraphs match `p` like any other, so the
                 * gutter beside one could be clicked - and it set `data-alert` on
                 * a line whose flag has nowhere to be drawn. The result is the
                 * phantom the empty-line guard was written for: no mark in the
                 * note, a chip in the strip pointing back at it. What is said in
                 * a meeting is a record, not a thing you flag; the action points
                 * the summary lifts OUT of it are.
                 */
                if (candidate.closest('[data-transcript], [data-recording]') !== null) {
                  return false
                }
                if (
                  candidate.dataset.provenance !== undefined ||
                  candidate.dataset.flagAll !== undefined
                ) {
                  return false
                }
                const box = candidate.getBoundingClientRect()
                return event.clientY >= box.top && event.clientY <= box.bottom
              })
              const line = candidates[candidates.length - 1]
              if (line !== undefined) {
                cycleAlert(line)
                return
              }
            }

            // A link to another note goes there - the list and the sidebar
            // follow, so it is clear where you have landed.
            const link = target.closest<HTMLElement>('a[data-note]')
            if (link !== null) {
              const linkedId = link.dataset.note
              if (linkedId !== undefined && link.dataset.gone === undefined) {
                onOpenNote(linkedId)
              }
              return
            }

            // The cross on a transcript's summary line. Caught before the
            // details element sees the click, so asking to delete does not also
            // fold or unfold the thing being deleted.
            const drop = target.closest<HTMLElement>('[data-drop="transcript"]')
            if (drop !== null) {
              event.preventDefault()
              const block = drop.closest<HTMLElement>('[data-transcript]')
              if (block !== null) {
                setPendingDrop(block)
              }
              return
            }

            /*
             * Flag every action point the summary listed, or take them all off.
             *
             * The lines it acts on are the ones the summary wrote - `data-action`
             * - not whatever sits under the heading, so a line typed in among
             * them afterwards is left alone in both directions.
             */
            const flagAll = target.closest<HTMLElement>('[data-flag-all]')
            if (flagAll !== null) {
              const section = flagAll.closest<HTMLElement>('[data-summary]')
              const lines =
                section === null
                  ? []
                  : Array.from(section.querySelectorAll<HTMLElement>('p[data-action]'))
              const flagging = lines.some((line) => line.dataset.alert === undefined)
              for (const line of lines) {
                if (flagging) {
                  if (line.dataset.alert === undefined) {
                    line.dataset.alert = '1'
                    line.dataset.alertId = newId('alert')
                  }
                } else {
                  delete line.dataset.alert
                  delete line.dataset.alertId
                }
              }
              if (section !== null) {
                applySummaryBlocks(section)
              }
              onBodyInput()
              return
            }

            /*
             * A timestamp beside a screenshot or a marked line: go and read what
             * was being said then. Caught before anything else, because the label
             * sits inside ordinary prose and a click on it must not also count as
             * a click on the paragraph.
             */
            const stamp = target.closest<HTMLElement>('[data-at-label]')
            if (stamp !== null) {
              // A block wears its label inside itself and an image wears it
              // beside itself, so the owner is whichever of the two is there.
              const owner =
                stamp.closest<HTMLElement>('[data-at]') ??
                (stamp.previousElementSibling instanceof HTMLElement
                  ? stamp.previousElementSibling
                  : null)
              if (owner !== null) {
                jumpToMoment(owner)
              }
              return
            }

            /*
             * The two offers on a transcribed recording, caught before the block
             * itself so that clicking a word on it does not also mean "transcribe".
             *
             * Running it again is not destructive - it replaces the transcript
             * with a fresh one from the same audio, which is the whole reason the
             * audio is still here. Discarding is, so it goes through the dialog.
             */
            const again = target.closest<HTMLElement>('[data-retranscribe]')
            if (again !== null) {
              const block = again.closest<HTMLElement>('[data-recording]')
              if (block !== null) {
                void transcribeBlock(block)
              }
              return
            }
            const trim = target.closest<HTMLElement>('[data-trim]')
            if (trim !== null) {
              const block = trim.closest<HTMLElement>('[data-recording]')
              if (block !== null) {
                setPendingTrim(block)
              }
              return
            }
            const discard = target.closest<HTMLElement>('[data-discard]')
            if (discard !== null) {
              const block = discard.closest<HTMLElement>('[data-recording]')
              if (block !== null) {
                setPendingAudioDrop(block)
              }
              return
            }

            // A recording that has not been turned into text yet: clicking it
            // is how you ask for that. A transcribed block answers on its two
            // controls above rather than anywhere on itself, and a lost one has
            // nothing left to offer.
            const recording = target.closest<HTMLElement>('[data-recording]')
            if (recording !== null) {
              const state = recording.dataset.state ?? 'recorded'
              if (state === 'recorded' || state === 'failed') {
                void transcribeBlock(recording)
              }
              return
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

        {/*
          What points AT this note.
          
          Below the text rather than beside it: it is not part of what the note
          says, it is a fact about where the note sits. And absent entirely when
          nothing links here - an empty "mentioned in" heading on every note would
          be a permanent reminder of a feature instead of a use of it.
        */}
        {mentions.length > 0 && (
          <div className="backlinks">
            {/*
              The heading is the control. It already carries the count, so
              collapsing hides the rows without hiding the fact that they exist -
              which is the whole reason a footnote may be folded away at all.

              A hub note is mentioned by every note it lists, so the panel there
              was a second copy of the note's own body, several rows deep, with
              no way to put it away.
            */}
            <button
              type="button"
              className="backlinks-label"
              aria-expanded={mentionsOpen}
              onClick={onToggleMentions}
              title={mentionsOpen ? 'Hide what points here' : 'Show what points here'}
            >
              <span className={`backlinks-caret${mentionsOpen ? ' is-open' : ''}`} aria-hidden>
                &#9656;
              </span>
              Mentioned in {mentions.length === 1 ? '1 note' : `${mentions.length} notes`}
            </button>
            {mentionsOpen && (
              <div className="backlinks-rows">
                {mentions.map((mention) => (
                  <button
                    key={mention.note.id}
                    type="button"
                    className="backlink"
                    onClick={() => onOpenNote(mention.note.id)}
                    title={`${mention.note.title.length > 0 ? mention.note.title : 'Untitled'} - ${mention.trail}`}
                  >
                    <span className="backlink-title">
                      {mention.note.title.length > 0 ? mention.note.title : 'Untitled'}
                    </span>
                    <span className="backlink-trail">{mention.trail}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
