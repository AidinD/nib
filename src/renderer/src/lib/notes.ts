import DOMPurify from 'dompurify'
import type { AlertMeta, Category, NibIndex, NoteMeta } from '@shared/types'

/**
 * Ids are used as filenames, so they stay inside the character class the storage
 * layer allows: letters, digits, dash, underscore.
 */
export function newId(prefix: string): string {
  const random = crypto.getRandomValues(new Uint8Array(8))
  const suffix = Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${prefix}-${suffix}`
}

/**
 * What a note body may contain once it comes back from the clipboard or from
 * disk.
 *
 * Pasting from a browser drags in scripts, event handlers, styles and remote
 * images. Notes are local, but a note file is also something an external tool or
 * a synced folder can write, so the body is sanitised on the way in AND on the
 * way out rather than trusted because "we wrote it".
 */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'div', 'span',
    'h1', 'h2', 'h3', 'h4',
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'code', 'pre', 'mark',
    'ul', 'ol', 'li', 'blockquote', 'hr',
    // A transcript is folded away by default - a 9000-word wall above the
    // summary is a note you stop opening. `details` does it natively, with a
    // keyboard and a screen reader, which a div and a click handler do not.
    'details', 'summary',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ],
  /*
   * No `class`.
   *
   * Nothing in a note needs one: the drawing block's class is put back on load by
   * `applyCanvasBlocks`, from the `data-canvas` that identifies it. Allowing them
   * meant every paste imported another app's CSS hooks - the 1-1 template came in
   * carrying `mat-mdc-menu-trigger` and `ng-star-inserted` - which style nothing
   * here and are pure weight in the file.
   */
  ALLOWED_ATTR: ['href', 'title', 'src', 'alt', 'open'],
  // The custom scheme is how a stored image is referenced; data: is what a paste
  // arrives as before it has been written to the assets folder.
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/|nib-asset:)/i
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG)
}

// Data attributes are allowed through by DOMPurify's own default, which is what
// `data-w`, `data-canvas`, `data-alert` and `data-alert-id` all rely on.

/**
 * An image's size lives in `data-w` and is applied as an inline style when the
 * note is loaded.
 *
 * The obvious ways to store it both fail. `style` is not on the allowed list, on
 * purpose - allowing arbitrary CSS in from a paste is exactly what a sanitiser is
 * for. And a plain `width` attribute was tried and does not survive this config
 * either: the size was set, looked right, and was gone after a reload. Data
 * attributes do survive, so the size is stored as one and turned back into a
 * width here, in the one place that runs after every load.
 */
export function applyImageWidths(root: HTMLElement): void {
  for (const image of root.querySelectorAll('img')) {
    const stored = Number(image.dataset.w)
    if (Number.isFinite(stored) && stored > 0) {
      image.style.width = `${stored}px`
    }
  }
}

/**
 * Make the canvas blocks in a note body uneditable.
 *
 * `contenteditable` is not an allowed attribute - it is exactly the kind of thing
 * a paste should not be able to smuggle in - so, like an image's width, it is
 * re-applied after every load instead of being stored.
 */
/**
 * A recording's block in the document.
 *
 * The same shape as a drawing block: identified by a data attribute, not by a
 * class, so what it IS survives the sanitiser and how it LOOKS is put back on
 * load. `data-recording` holds the file path, `data-seconds` its length, and
 * `data-state` where it is in the journey from audio to transcript - where
 * `transcribed` no longer means the audio is gone. `lost` is what says that.
 *
 * Not editable, because it is a control rather than prose - and its text is
 * rebuilt here on every load, so a half-deleted label cannot survive in a note.
 */
export function applyRecordingBlocks(root: HTMLElement): void {
  for (const block of root.querySelectorAll<HTMLElement>('[data-recording]')) {
    block.contentEditable = 'false'
    block.classList.add('recording-block')
    const seconds = Number(block.dataset.seconds ?? 0)
    const minutes = Math.floor(seconds / 60)
    const state = block.dataset.state ?? 'recorded'
    if (state === 'failed') {
      // Its text is the reason it failed, written when it happened. Rebuilding it
      // here would replace the one useful thing on the block with a label.
      continue
    }
    const length = `${minutes}:${String(seconds % 60).padStart(2, '0')}`
    const language = block.dataset.language === 'en' ? 'English' : 'Svenska'

    /*
     * The offer to cut, when the file says the call ended before the recording did.
     *
     * Written here rather than at the moment it is found, so it survives a save
     * and a reload like every other thing about a block: `data-call-end` is the
     * fact, this is only how it looks. It is an offer on both a raw recording and
     * a transcribed one - discovering the mistake after reading the transcript is
     * if anything the likelier way round.
     */
    const offerTrim = (): void => {
      const endsAt = Number(block.dataset.callEnd ?? '')
      if (!Number.isFinite(endsAt) || endsAt <= 0 || endsAt >= seconds) {
        return
      }
      const trim = document.createElement('span')
      trim.dataset.trim = String(endsAt)
      trim.textContent = `the call ends at ${clock(endsAt)} · trim the rest`
      block.append(document.createTextNode(' · '), trim)
    }

    /*
     * A transcribed recording keeps its audio, so the block is not a receipt for
     * something finished - it is the two things still worth doing.
     *
     * The audio used to be deleted the moment the words landed in the note. That
     * read as tidy and meant a wrong word was permanent: the first real meeting
     * came back about nine tenths right, with names mangled, and there was
     * nothing left to run again. So the file stays until it is thrown away on
     * purpose, and both offers sit on the block rather than behind a menu.
     */
    if (state === 'transcribed') {
      block.textContent = `Recording · ${length} · ${language} · transcribed · the audio is still here · `
      const again = document.createElement('span')
      again.dataset.retranscribe = '1'
      again.textContent = 'transcribe again'
      const discard = document.createElement('span')
      discard.dataset.discard = '1'
      discard.textContent = 'discard the audio'
      block.append(again, document.createTextNode(' · '), discard)
      offerTrim()
      continue
    }

    block.textContent =
      state === 'working'
        ? `Recording · ${length} · transcribing…`
        : state === 'lost'
          ? // The audio is gone: discarded on purpose, thrown away with its note,
            // or transcribed back when transcribing deleted it. The block stays
            // because it marks where the meeting was, but it no longer offers
            // something it cannot do.
            `Recording · ${length} · the audio is no longer on disk`
          : `Recording · ${length} · ${language} · click to transcribe`
    if (state === 'recorded') {
      offerTrim()
    }
  }
}

/**
 * Put the delete control back on every transcript.
 *
 * Done on load rather than only at insertion, because transcripts written before
 * the control existed have none - and a feature that only reaches notes made
 * after it shipped is a feature half the notebook does not have. It is also how
 * the control survives someone editing the summary line by hand.
 */
export function applyTranscriptBlocks(root: HTMLElement): void {
  for (const block of root.querySelectorAll<HTMLElement>('[data-transcript]')) {
    /*
     * The transcript is not editable text, and saying so is what keeps it.
     *
     * It was left editable, so an ordinary Backspace with the caret at the edge
     * of it emptied the block instead of removing it - leaving the summary line
     * still claiming "8 avsnitt" over nothing, and the words gone from disk at
     * the next save. Chromium will not delete a `details` element (see the drop
     * handler), so it deletes the inside, which is the worst of the two.
     *
     * Non-editable matches the drawing and recording blocks, still selects and
     * copies, still folds, and leaves the cross as the one way to remove it.
     */
    block.contentEditable = 'false'
    const line = block.querySelector('summary')
    if (line === null) {
      continue
    }
    const already = line.querySelector<HTMLElement>('[data-drop]')
    if (already !== null) {
      // An earlier edit could empty the cross without removing the span - the
      // browser leaves a `<br>` behind. Put the character back rather than
      // leaving a control that is there but invisible.
      if ((already.textContent ?? '').trim().length === 0) {
        already.textContent = '×'
      }
      continue
    }
    const drop = document.createElement('span')
    drop.dataset.drop = 'transcript'
    drop.title = 'Ta bort transkriptet'
    drop.textContent = '×'
    line.appendChild(drop)
  }
}

/** What one of a note's top-level children is, as far as placement cares. */
export type BlockKind = 'summary' | 'recording' | 'transcript' | 'other'

/**
 * Where a finished recording's block belongs among a note's top-level children.
 *
 * It used to belong at the very end, and the reason was sound as far as it went:
 * the caret is wherever you were typing during the meeting, so inserting at the
 * caret would drop a block into the middle of a sentence. The end is not where it
 * belongs though - it is only where the last thing that happened lands. A meeting
 * marked with nine screenshots put the recording, its controls and a
 * half-hour transcript below all nine, so opening the note meant scrolling past
 * every image to reach the thing the note is about.
 *
 * So: the top, under a summary if there is one. The summary is an account of the
 * meeting and the transcript is the meeting, and that is the order to read them
 * in. It costs one line rather than a wall, because the transcript is folded.
 *
 * The exception, and the reason this is a function rather than "index 0": a
 * SECOND recording goes after the first, not above it. Document order is what
 * pairs a transcript with its own recording block, and what tells the summary
 * which half of the conversation came first - so recorded order and document
 * order have to stay the same thing. That also leaves an older note, whose
 * recording is still at the bottom, working exactly as it did.
 *
 * "After the first" means after the last recording OR transcript, whichever
 * comes later, and not "after the block, or two on if a transcript follows it".
 * The first version was the second thing, and a real note showed why it is
 * wrong: the block and its transcript are not always neighbours. A half-hour
 * meeting had `<div data-recording><p></p><details data-transcript>` - an empty
 * paragraph in between, left over from the place-to-type this used to append -
 * so the next recording would have gone into that gap, between a block and its
 * own transcript. On screen that is a blank line. To `transcriptsWithMarks` it
 * is the transcript now being preceded by the WRONG recording, which files every
 * screenshot under the wrong meeting.
 */
export function recordingInsertAt(kinds: BlockKind[]): number {
  const last = Math.max(kinds.lastIndexOf('recording'), kinds.lastIndexOf('transcript'))
  if (last >= 0) {
    return last + 1
  }
  const summary = kinds.indexOf('summary')
  return summary >= 0 ? summary + 1 : 0
}

/**
 * Which kind a top-level child is.
 *
 * `closest` is not enough and neither is a plain attribute check: a transcript
 * read back from disk arrives wrapped in a paragraph, so the child that
 * represents it is a `p` that CONTAINS the `details`. Asking about the subtree is
 * what makes a reloaded note sort the same as a freshly recorded one.
 */
export function blockKind(child: {
  dataset: DOMStringMap
  querySelector: (selector: string) => unknown
}): BlockKind {
  for (const kind of ['summary', 'recording', 'transcript'] as const) {
    if (kind in child.dataset || child.querySelector(`[data-${kind}]`) !== null) {
      return kind
    }
  }
  return 'other'
}

/**
 * Put a recording's block where it belongs, and answer whether it landed last.
 *
 * The caller needs to know: an empty paragraph after the block is a place to
 * type when there is nothing below it, and a blank line pushed into the middle of
 * a note when there is.
 */
export function placeRecording(root: HTMLElement, block: HTMLElement): boolean {
  // `children` is typed as plain `Element`, which has no `dataset`. Everything a
  // note body holds is HTML - the sanitiser's allow-list is all HTML tags.
  const children = Array.from(root.children) as HTMLElement[]
  const before = children[recordingInsertAt(children.map((child) => blockKind(child)))] ?? null
  root.insertBefore(block, before)
  return before === null
}

/**
 * Write the label on the summary's flag-all control, and keep it honest.
 *
 * It says what the next click will do, which depends on the lines above it: with
 * anything unflagged it offers to flag them, and once they all carry a flag it
 * offers to take them off again. Recomputed on load and after every click, so a
 * note reopened tomorrow does not offer to flag what is already flagged.
 *
 * A summary with no action lines left - they can be deleted like any other line -
 * loses the control rather than keeping a button that acts on nothing.
 */
export function applySummaryBlocks(root: HTMLElement): void {
  /*
   * A wrapper with no summary left in it is not a summary.
   *
   * The block is ordinary editable text - you must be able to fix a sentence the
   * model got wrong - so its contents can be deleted, and deleting them leaves
   * the `div` behind. It draws a rule under itself to mark where the machine
   * stopped writing, so an empty one is a line across the note that cannot be
   * removed: it is a border, not a character, and there is nothing to put the
   * caret on. Worse, Chromium answers a deletion that empties a block by pulling
   * the NEXT block into it, so the note's own first heading ended up inside a
   * wrapper it had nothing to do with.
   *
   * Recognised by the signature and the action lines, both of which every
   * generated summary has and neither of which anyone types by hand. Unwrapped
   * rather than removed: whatever is in there is the note's now.
   */
  for (const section of Array.from(root.querySelectorAll<HTMLElement>('[data-summary]'))) {
    if (
      section.querySelector('[data-provenance]') !== null ||
      section.querySelector('p[data-action]') !== null
    ) {
      continue
    }
    const parent = section.parentNode
    if (parent === null) {
      continue
    }
    while (section.firstChild !== null) {
      parent.insertBefore(section.firstChild, section)
    }
    section.remove()
  }

  /*
   * Give the control to summaries written before every summary got one.
   *
   * A meeting summary used to flag its own action points and had no control,
   * because there was nothing left to flag. Now that nothing flags itself, those
   * notes are the ones that most need it: their lines are all flagged, and the
   * control is what offers to take the flags off. Their flags are left exactly as
   * they are - promoting was the summary's mistake, and unflagging what somebody
   * has since acted on would be this one.
   *
   * Placed after the last action line rather than at the end of the section, so
   * it sits under the list it acts on and not below the signature.
   */
  for (const section of root.querySelectorAll<HTMLElement>('[data-summary]')) {
    if (section.querySelector('[data-flag-all]') !== null) {
      continue
    }
    const lines = section.querySelectorAll<HTMLElement>('p[data-action]')
    if (lines.length === 0) {
      continue
    }
    const control = document.createElement('p')
    control.dataset.flagAll = '1'
    lines[lines.length - 1].after(control)
  }

  for (const control of root.querySelectorAll<HTMLElement>('[data-flag-all]')) {
    const section = control.closest<HTMLElement>('[data-summary]')
    const lines =
      section === null ? [] : Array.from(section.querySelectorAll<HTMLElement>('p[data-action]'))
    if (lines.length === 0) {
      control.remove()
      continue
    }
    control.contentEditable = 'false'
    const unflagged = lines.filter((line) => line.dataset.alert === undefined)
    control.dataset.flagAll = unflagged.length > 0 ? '1' : 'undo'
    control.textContent =
      unflagged.length === 0
        ? 'Ta bort flaggorna'
        : unflagged.length === 1 && lines.length === 1
          ? 'Flagga som åtgärdspunkt'
          : `Flagga alla ${unflagged.length} som åtgärdspunkter`
  }
}

export function applyCanvasBlocks(root: HTMLElement): void {
  for (const block of root.querySelectorAll('[data-canvas]')) {
    ;(block as HTMLElement).contentEditable = 'false'
    // The class is not stored - see ALLOWED_ATTR. `data-canvas` is what makes
    // this a drawing block; the class is only how it is painted.
    block.classList.add('canvas-block')
  }
}

/**
 * Put nested lists where they belong: inside the item they hang off.
 *
 * Chromium's `indent` produces `<ul><li>a</li><ul><li>b</li></ul></ul>` - a list
 * as a direct child of a list, which no HTML parser considers valid and which
 * loses the relationship between the sub-item and its parent. The valid shape is
 * `<ul><li>a<ul><li>b</li></ul></li></ul>`.
 *
 * It renders about the same either way, which is why it is easy to leave - but
 * the note file is the durable artefact here, and it should be something another
 * renderer can read correctly.
 */
/**
 * Make the body's own blocks paragraphs.
 *
 * Chromium's default block for a new line is `div`, and a div is invisible to
 * everything in this app that asks "which line am I on": the alert marker, the
 * markdown shortcuts and Tab all look for a paragraph, a heading, a list item or
 * a quote. Notes typed before the paragraph separator was set carry divs, so they
 * are converted on load rather than left as lines the editor cannot see.
 *
 * A canvas block is a div too, and stays one - it is not a line of text.
 */
/**
 * The data attributes that make a `div` one of this app's own blocks.
 *
 * Add a block type, add it here. Forgetting to is not a cosmetic bug: the wrapper
 * is unwrapped on the next load, the marker is gone, and whatever the block was
 * for silently stops working.
 */
const OWN_BLOCKS = ['canvas', 'summary', 'recording', 'transcript']

export function normaliseBlocks(root: HTMLElement): void {
  /*
   * Wrappers from somewhere else are taken apart.
   *
   * A paste out of a web app arrives wrapped in that app's own layout - the 1-1
   * template pasted into this notebook came as a list buried three `div`s deep,
   * each carrying a stack of classes. Nib has no meaning for a `div` other than a
   * drawing block, and a list inside one is a list that markdown shortcuts, Tab
   * and the alert marker can all still reach - but only once the wrapper is gone.
   *
   * A `div` holding blocks is unwrapped in place; one holding only text becomes a
   * paragraph. Deepest first, so a wrapper full of wrappers comes apart in one
   * pass.
   */
  const wrappers = Array.from(root.querySelectorAll('div')).reverse()
  for (const wrapper of wrappers) {
    /*
     * A `div` this app put there is structure, not imported junk.
     *
     * The unwrapping exists for pasted layout - three levels of someone else's
     * flexbox around a list - and it happily took Nib's own wrappers with it.
     *
     * It cost the same bug twice. The summary block lost its marker, so the next
     * summary would have fed on the last one. Then a recording block lost its
     * marker on the first reload, which turned a meeting waiting to be
     * transcribed into a line of ordinary text and left the audio on disk with
     * nothing pointing at it. Both times the fix was one more name in a list,
     * which is why there is now a list rather than a condition: anything this app
     * marks with one of these attributes is a block, and blocks are not unwrapped.
     */
    if (OWN_BLOCKS.some((attribute) => attribute in (wrapper as HTMLElement).dataset)) {
      continue
    }
    const holdsBlocks = wrapper.querySelector(
      ':scope > p, :scope > ul, :scope > ol, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > blockquote, :scope > pre, :scope > hr, :scope > table, :scope > div'
    )
    if (holdsBlocks !== null) {
      wrapper.replaceWith(...Array.from(wrapper.childNodes))
      continue
    }
    const paragraph = document.createElement('p')
    while (wrapper.firstChild !== null) {
      paragraph.appendChild(wrapper.firstChild)
    }
    wrapper.replaceWith(paragraph)
  }

  /*
   * And a `span` that says nothing is unwrapped too. What made it a span was a
   * class or an inline style, and the sanitiser keeps neither - so it is left
   * doing nothing but breaking the text into pieces, which is enough to stop an
   * inline markdown shortcut from seeing its own pair.
   */
  for (const span of Array.from(root.querySelectorAll('span'))) {
    if (span.attributes.length === 0) {
      span.replaceWith(...Array.from(span.childNodes))
    }
  }

  /*
   * Text sitting directly under the body, in no block at all, is adopted by a
   * paragraph.
   *
   * It happens after a divider - and it is the worst kind of broken, because it
   * looks perfectly normal and nothing works on it: no alert marker, no markdown
   * shortcut, no Tab, since every one of them asks which block the caret is in.
   */
  let loose: ChildNode[] = []
  const adopt = (): void => {
    if (loose.length === 0) {
      return
    }
    const paragraph = document.createElement('p')
    loose[0].before(paragraph)
    for (const node of loose) {
      paragraph.appendChild(node)
    }
    loose = []
  }
  for (const node of Array.from(root.childNodes)) {
    const isBlock =
      node.nodeType === Node.ELEMENT_NODE &&
      /^(P|H1|H2|H3|H4|UL|OL|BLOCKQUOTE|PRE|HR|DIV|TABLE)$/.test((node as Element).tagName)
    if (isBlock) {
      adopt()
      continue
    }
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length === 0) {
      continue
    }
    loose.push(node)
  }
  adopt()
}

export function normaliseLists(root: HTMLElement): void {
  for (const nested of root.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol')) {
    const previous = nested.previousElementSibling
    if (previous?.tagName === 'LI') {
      previous.appendChild(nested)
    }
  }

  /*
   * An item inside an item is lifted out to sit after it.
   *
   * Chromium's `outdent` leaves this shape - `<li>Two<ul>...</ul><li></li></li>` -
   * when it takes an item one level out, and it renders as a bullet swallowed by
   * the one above. Notes written before Enter stopped going through `outdent`
   * still contain it, so this heals them on the way in.
   */
  for (const stray of root.querySelectorAll('li > li')) {
    stray.parentElement?.after(stray)
  }

  /*
   * A list inside a paragraph is lifted out of it.
   *
   * `insertUnorderedList` on an empty paragraph wraps rather than replaces:
   * `<p><ul><li>...</li></ul></p>`. It looks right on screen and is invalid, so
   * the parser rearranges it the next time the note is read from disk - which is
   * how a note full of bullets came back as one run-together paragraph.
   */
  for (const list of root.querySelectorAll('p > ul, p > ol')) {
    const paragraph = list.parentElement
    if (paragraph === null) {
      continue
    }
    const hasOtherContent = Array.from(paragraph.childNodes).some(
      (node) => node !== list && (node.textContent ?? '').trim().length > 0
    )
    if (hasOtherContent) {
      paragraph.after(list)
    } else {
      paragraph.replaceWith(list)
    }
  }
}

/** The stored width of an image, or its natural width when it has none yet. */
export function imageWidth(image: HTMLImageElement): number {
  const stored = Number(image.dataset.w)
  return Number.isFinite(stored) && stored > 0 ? stored : image.naturalWidth
}

/**
 * The note body as a detached element, with the drawing blocks taken out.
 *
 * A canvas block carries no text of the author's - its label is drawn by CSS
 * precisely so it cannot leak into a preview, a word count or a search - but an
 * image's alt text inside one would, so the blocks are removed here rather than
 * trusted to be empty.
 */
function bodyElement(html: string): HTMLElement {
  const holder = document.createElement('div')
  holder.innerHTML = sanitizeHtml(html)
  for (const block of holder.querySelectorAll('[data-canvas]')) {
    block.remove()
  }
  return holder
}

/** A note's plain text, used for previews, word counts and search. */
export function htmlToText(html: string): string {
  return (bodyElement(html).textContent ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * The card preview: the note's block elements joined with a middle dot, as the
 * design spec specifies, rather than the first N characters of a run-on string.
 * Blocks read as separate thoughts that way even at two lines.
 */
export function buildPreview(html: string): string {
  const holder = bodyElement(html)
  const blocks = holder.querySelectorAll('p, h1, h2, h3, h4, li, blockquote, pre')
  const parts: string[] = []
  for (const block of blocks) {
    const text = (block.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text.length > 0) {
      parts.push(text)
    }
    if (parts.join(' · ').length > 180) {
      break
    }
  }
  const joined = parts.length > 0 ? parts.join(' · ') : htmlToText(html)
  return joined.slice(0, 200)
}

/** Blocks that can carry an alert flag - the ones a thought fits in. */
const ALERT_BLOCKS = 'p, h1, h2, h3, h4, li, blockquote'

/**
 * The action points flagged inside a note body.
 *
 * The flag is `data-alert` on a block, with `data-alert-id` identifying it so a
 * click in the alert strip can jump back to the exact block. Both are data
 * attributes because those are what survive the sanitiser - see
 * `applyImageWidths` for the same lesson learned the hard way.
 */
export function extractAlerts(html: string): AlertMeta[] {
  const holder = bodyElement(html)
  const alerts: AlertMeta[] = []
  for (const block of holder.querySelectorAll(`${ALERT_BLOCKS}`)) {
    const element = block as HTMLElement
    const state = element.dataset.alert
    // '1' is an open action point, 'done' one that has been ticked off but is
    // still marked in the note. Anything else is not an action point at all.
    if (state !== '1' && state !== 'done') {
      continue
    }
    const id = element.dataset.alertId
    if (id === undefined || id.length === 0) {
      continue
    }
    alerts.push({
      id,
      text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      done: state === 'done'
    })
  }
  return alerts
}

/**
 * Whether a block is one of a generated summary's own headings.
 *
 * `Sammanfattning`, `Beslut`, `Åtgärdspunkter`, `Frågor jag inte ställde` - the
 * structure the summary writes, not anything anybody promised. Flagging one puts
 * 160 characters of the summary in the index as an action point, and from there
 * into Tend as a promise nobody made. It happened: the gutter runs the whole
 * height of the document's left margin, so a stray click level with the first
 * heading flagged it, and the three-state cycle turned the attempt to undo it
 * into a green tick.
 *
 * The same reasoning the gutter already applies to a transcript's lines: what was
 * said in a meeting is a record, and what you flag is the action points the
 * summary lifts out of it. The action lines themselves stay flaggable, and so
 * does the summary's prose - only the headings stop being targets.
 */
export function isSummaryHeading(block: {
  tagName: string
  closest: (selector: string) => unknown
}): boolean {
  return /^H[1-4]$/.test(block.tagName) && block.closest('[data-summary]') !== null
}

/** The block a selection sits in, or null when the selection is outside `root`. */
export function blockAtSelection(root: HTMLElement): HTMLElement | null {
  const selection = window.getSelection()
  const anchor = selection?.anchorNode ?? null
  if (anchor === null || !root.contains(anchor)) {
    return null
  }
  const start = anchor instanceof HTMLElement ? anchor : anchor.parentElement
  const block = start?.closest(ALERT_BLOCKS) ?? null
  // `closest` can walk out of the editor entirely; only a block inside it counts.
  return block !== null && root.contains(block) ? (block as HTMLElement) : null
}

export function wordCount(html: string): number {
  const text = htmlToText(html)
  return text.length === 0 ? 0 : text.split(/\s+/).length
}

export function bodyHasImage(html: string): boolean {
  return /<img\b/i.test(html)
}

export function bodyHasDrawing(html: string): boolean {
  return /data-canvas/i.test(html)
}

/** The first line of a note, used to title an untitled one. */
export function deriveTitle(html: string): string {
  const text = htmlToText(html)
  if (text.length === 0) {
    return ''
  }
  return text.slice(0, 60)
}

const DAY = 86_400_000

/** `today`, `yesterday`, `3 days ago`, `2w ago` - the spec's own vocabulary. */
/**
 * A fixed date, for the thing about a note that never changes.
 *
 * The year is left off when it is this one: "24 Aug" reads faster than
 * "24 Aug 2026" on every card in a list where almost everything is from this
 * year, and the moment it is not this year the year is exactly what you needed.
 */
export function dateStamp(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

/** Whether two timestamps fall on the same calendar day. */
export function sameDay(a: number, b: number): boolean {
  const one = new Date(a)
  const two = new Date(b)
  return (
    one.getFullYear() === two.getFullYear() &&
    one.getMonth() === two.getMonth() &&
    one.getDate() === two.getDate()
  )
}

/**
 * The reference for a note, to paste into a conversation.
 *
 * The note's own id, with the title beside it. The id is what makes it findable
 * - it is the name of the file the body lives in, and what Tend keys its own rows
 * on - and the title is there so the person pasting it can see they copied the
 * right card.
 *
 * Deliberately NOT a new short number. A second identifier for the same note is
 * a second thing that can be out of step with the first, and this notebook has
 * already been bitten by that twice today: a tag mapped by name, and a folder
 * addressed by its path.
 */
export function noteReference(id: string, title: string): string {
  const name = title.trim().length > 0 ? title.trim() : 'Untitled'
  return `nib:${id} "${name}"`
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const days = Math.floor((startOfToday.getTime() - timestamp) / DAY)

  if (timestamp >= startOfToday.getTime()) {
    return 'today'
  }
  if (days < 1) {
    return 'yesterday'
  }
  if (days < 7) {
    return `${days + 1} days ago`
  }
  const weeks = Math.floor((days + 1) / 7)
  if (weeks < 5) {
    return `${weeks}w ago`
  }
  const months = Math.floor((days + 1) / 30)
  if (months < 12) {
    return `${months}mo ago`
  }
  return `${Math.floor((days + 1) / 365)}y ago`
}

/** Everything under a category: its loose notes and its sub-categories' both. */
export function categoryCount(category: Category): number {
  return category.notes.length
}

export function subCount(category: Category, subId: string): number {
  // Archived notes are excluded, because this number is a promise about what
  // clicking the row will show, and the row's list leaves them out.
  return category.notes.filter((note) => note.subId === subId && !note.archived).length
}

/** The `Category › Sub-category` trail shown on cards, in the editor and on stickies. */
export function noteTrail(categories: Category[], note: NoteMeta): string {
  const category = categories.find((c) => c.id === note.categoryId)
  if (category === undefined) {
    return ''
  }
  if (note.subId === null) {
    return category.name
  }
  const sub = category.subs.find((s) => s.id === note.subId)
  return sub === undefined ? category.name : `${category.name} › ${sub.name}`
}

/**
 * Take an empty list item out of its list - one level, or out altogether.
 *
 * Done by moving nodes rather than with `document.execCommand('outdent')`, which
 * is the one place in this editor where the browser's own command could not be
 * trusted: it moved the item INSIDE its parent item, and on a sub-list it moved
 * the whole sub-list out to sit beside the item it belonged to. Both are invalid
 * HTML, and both put the caret a line or two from where the author was typing.
 *
 * The cost of doing it by hand is that this one step is not on the browser's undo
 * stack, so Ctrl+Z will not put the bullet back. That is the better trade: the
 * command that was on the undo stack produced a document that had to be repaired
 * on its next read.
 *
 * Items below the empty one travel with it, so the order on screen never changes:
 * out of a sub-list they become its children, and out of a top-level list they
 * carry on as a second list below the new paragraph.
 */
export function leaveEmptyItem(item: HTMLElement): boolean {
  const list = item.parentElement
  if (list === null || (list.tagName !== 'UL' && list.tagName !== 'OL')) {
    return false
  }

  const trailing: Element[] = []
  for (let sibling = item.nextElementSibling; sibling !== null; ) {
    const next = sibling.nextElementSibling
    trailing.push(sibling)
    sibling = next
  }
  const collectTrailing = (): HTMLElement | null => {
    if (trailing.length === 0) {
      return null
    }
    const rest = document.createElement(list.tagName.toLowerCase())
    for (const node of trailing) {
      rest.appendChild(node)
    }
    return rest
  }

  const parentItem = list.parentElement?.tagName === 'LI' ? list.parentElement : null
  const caretInto = (target: HTMLElement): void => {
    const range = document.createRange()
    range.setStart(target, 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  if (parentItem !== null) {
    item.remove()
    const rest = collectTrailing()
    if (rest !== null) {
      item.appendChild(rest)
    }
    parentItem.after(item)
    if (list.childElementCount === 0) {
      list.remove()
    }
    caretInto(item)
    return true
  }

  const paragraph = document.createElement('p')
  paragraph.appendChild(document.createElement('br'))
  item.remove()
  list.after(paragraph)
  const rest = collectTrailing()
  if (rest !== null) {
    paragraph.after(rest)
  }
  if (list.childElementCount === 0) {
    list.remove()
  }
  caretInto(paragraph)
  return true
}

/**
 * A link to another note, as the document stores it.
 *
 * `data-note` rather than an `href`: there is no URL for a note, and giving it a
 * fake one would mean the click had to be intercepted before the browser tried
 * to navigate. The visible text is the title as it read when the link was made,
 * and it is refreshed on every load - so renaming a note does not leave stale
 * names scattered through the notebook.
 */
export function noteLinkHtml(id: string, title: string): string {
  const label = (title.length > 0 ? title : 'Untitled').replace(
    /[&<>]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] ?? character
  )
  return `<a data-note="${id}">${label}</a>`
}

/**
 * Bring every note link's label up to date, and mark the ones that lead nowhere.
 *
 * A link to a deleted note is not removed. It is marked, and keeps the title it
 * had: "this pointed at the 1-1 from March, which is gone" is worth more than a
 * blank, and deciding on the author's behalf that the sentence should lose a word
 * is not this function's business.
 */
export function applyNoteLinks(root: HTMLElement, titles: Map<string, string>): void {
  for (const link of Array.from(root.querySelectorAll<HTMLElement>('a[data-note]'))) {
    const id = link.dataset.note
    const title = id === undefined ? undefined : titles.get(id)
    if (title === undefined) {
      link.dataset.gone = '1'
      link.title = 'The note this pointed to is gone'
      continue
    }
    delete link.dataset.gone
    link.title = title
    if (link.textContent !== title) {
      link.textContent = title
    }
  }
}

/**
 * The notes a body links to, in the order they appear.
 *
 * Written to the note's meta on every save, which is what makes the reverse
 * question - "what points at this note" - a walk over the index rather than a
 * read of every file in the notebook.
 */
export function extractLinks(html: string): string[] {
  const holder = document.createElement('div')
  holder.innerHTML = html
  const found = new Set<string>()
  for (const link of holder.querySelectorAll<HTMLElement>('a[data-note]')) {
    const id = link.dataset.note
    if (id !== undefined && id.length > 0) {
      found.add(id)
    }
  }
  return [...found]
}

/** Every note's title, by id - what `applyNoteLinks` needs. */
export function noteTitles(index: NibIndex): Map<string, string> {
  const titles = new Map<string, string>()
  for (const category of index.categories) {
    for (const note of category.notes) {
      titles.set(note.id, note.title.length > 0 ? note.title : 'Untitled')
    }
  }
  return titles
}

/**
 * A transcript, folded, as the document stores it.
 *
 * Timestamps are kept because they are what makes a transcript navigable - "he
 * said that around eleven minutes" is how anybody actually refers to a recording -
 * and because the summary pass uses them to point at moments.
 *
 * One paragraph per segment rather than one wall of text: the editor works on
 * blocks, so a flat blob could not be flagged, quoted or split, and a transcript
 * you cannot mark up is a transcript you can only read.
 *
 * ## The names on the turns
 *
 * A recording that kept the microphone and the machine's own output on separate
 * channels comes back labelled, and `speakers` is what those labels are called
 * in this note. It is not voice recognition: whisper reports which channel was
 * louder, so what the label really says is which side of the call spoke - which
 * happens to be the only distinction the summary needs to tell your promises
 * from theirs.
 *
 * The name is printed when the speaker CHANGES rather than on every line. A name
 * in front of all four hundred lines is a column of noise; printed on the turn it
 * reads the way a transcript is supposed to.
 *
 * `?` is whisper's own doubt, and it is kept. It means the two channels were
 * level - people talking over each other, or the far side coming back through
 * the room into the microphone - and a guess with somebody's name on it would be
 * worse than the question mark.
 */
export function transcriptHtml(
  segments: { start: string; end: string; text: string; speaker?: string }[],
  minutes: number,
  speakers?: { mine: string; theirs: string }
): string {
  const escape = (text: string): string =>
    text.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] ?? character)

  /** Which side a segment came from, as the attribute the styling hangs on. */
  const side = (speaker: string): 'mine' | 'theirs' | 'unknown' =>
    speaker === '0' ? 'mine' : speaker === '1' ? 'theirs' : 'unknown'

  const named = (speaker: string): string => {
    if (speakers === undefined) {
      return ''
    }
    const which = side(speaker)
    const name = which === 'mine' ? speakers.mine : which === 'theirs' ? speakers.theirs : '?'
    return `<span data-speaker="${which}">${escape(name)}</span> `
  }

  let previous: string | null = null
  const lines = segments
    .filter((segment) => segment.text.length > 0)
    .map((segment) => {
      const speaker = segment.speaker
      const turn = speaker !== undefined && speaker !== previous ? named(speaker) : ''
      previous = speaker ?? previous
      return `<p><em>${segment.start.replace(/^00:/, '')}</em> ${turn}${escape(segment.text)}</p>`
    })
    .join('')
  return (
    `<details data-transcript="1">` +
    // The delete control lives in the summary line, which is the one part of a
    // folded block that is always on screen. `data-drop` rather than a class,
    // because a class does not survive the sanitiser and this has to still be
    // there after a reload.
    `<summary>Transkript · ${minutes} min · ${segments.length} avsnitt` +
    `<span data-drop="transcript" title="Ta bort transkriptet">×</span></summary>` +
    (lines.length > 0 ? lines : '<p><em>Ingenting hördes.</em></p>') +
    `</details>`
  )
}

/**
 * A length in seconds as a clock, the way the transcript writes one.
 *
 * Minutes without a leading zero, because a timestamp beside a screenshot is
 * read as "eleven minutes in" rather than as a duration.
 */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const rest = String(whole % 60).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`
}

/**
 * How far into the recording one transcript line is.
 *
 * Read back off the `em` the line was written with rather than stored a second
 * time, so this answers for every transcript in the notebook and not only for
 * the ones written after moments existed.
 */
export function lineSeconds(line: HTMLElement): number | null {
  const stamp = line.querySelector('em')?.textContent?.trim() ?? ''
  if (stamp.length === 0) {
    return null
  }
  const parts = stamp.split(':').map(Number)
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) {
    return null
  }
  return parts.reduce((total, part) => total * 60 + part, 0)
}

/**
 * The transcript that belongs to a recording.
 *
 * Document order rather than sibling walking, for the reason `transcribeBlock`
 * already found: a transcript read back from disk comes wrapped in a paragraph,
 * so the block's next sibling is a `p` and not the `details` inside it.
 *
 * A note with exactly one transcript answers with it whatever was asked, which
 * is what keeps a moment working after its recording block has been deleted -
 * the block is a control, the transcript is the content, and people throw the
 * control away.
 */
export function transcriptForRecording(
  root: HTMLElement,
  recording?: string
): HTMLElement | null {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('[data-recording], [data-transcript]')
  )
  const transcripts = blocks.filter((block) => block.hasAttribute('data-transcript'))
  if (recording !== undefined && recording.length > 0) {
    const at = blocks.findIndex((block) => block.dataset.recording === recording)
    const next = at < 0 ? undefined : blocks[at + 1]
    if (next !== undefined && next.hasAttribute('data-transcript')) {
      return next
    }
  }
  return transcripts.length === 1 ? transcripts[0] : null
}

/** The last line at or before a moment - where a click on it should land. */
export function transcriptLineAt(transcript: HTMLElement, at: number): HTMLElement | null {
  let best: HTMLElement | null = null
  for (const line of transcript.querySelectorAll<HTMLElement>('p')) {
    const seconds = lineSeconds(line)
    if (seconds === null || seconds > at) {
      continue
    }
    best = line
  }
  return best
}

/** What a mark says, with its own timestamp label left out of the answer. */
function markText(owner: HTMLElement): string {
  if (owner.tagName === 'IMG') {
    return '(skärmbild)'
  }
  const copy = owner.cloneNode(true) as HTMLElement
  for (const label of copy.querySelectorAll('[data-at-label]')) {
    label.remove()
  }
  const text = (copy.textContent ?? '').trim()
  return text.length > 0 ? text : '(markerat)'
}

/**
 * Everything in the note that is pinned to a moment in a recording.
 *
 * A screenshot pasted during a meeting, or a line marked while it was being
 * said. `data-at` is the offset in seconds and `data-rec` says which recording
 * it belongs to - both survive the sanitiser, which is why they are attributes
 * rather than a class or a wrapper.
 *
 * Nothing is written into the audio file. The offset comes from the recorder's
 * own sample count, which is the only clock that cannot drift from the file, and
 * the WAV is left exactly as it was recorded - it is the one artefact here that
 * cannot be made a second time.
 */
export function timeMarks(
  root: HTMLElement
): { owner: HTMLElement; at: number; recording: string; text: string }[] {
  const marks: { owner: HTMLElement; at: number; recording: string; text: string }[] = []
  for (const owner of root.querySelectorAll<HTMLElement>('[data-at]')) {
    if (owner.closest('[data-transcript]') !== null) {
      continue
    }
    const at = Number(owner.dataset.at)
    if (!Number.isFinite(at)) {
      continue
    }
    marks.push({ owner, at, recording: owner.dataset.rec ?? '', text: markText(owner) })
  }
  return marks.sort((a, b) => a.at - b.at)
}

/**
 * Put the timestamp back on every moment.
 *
 * Rebuilt on load the way the transcript's cross is, rather than stored: the
 * label is a control, and a half-deleted one must not be able to survive in a
 * note. An image wears it after itself; anything else wears it in front.
 *
 * The first pass removes labels whose owner has gone. Deleting the screenshot
 * has to take its timestamp with it, and the browser will happily leave the span
 * behind on its own.
 */
export function applyTimeMarks(root: HTMLElement): void {
  for (const label of root.querySelectorAll<HTMLElement>('[data-at-label]')) {
    const before = label.previousElementSibling
    const parent = label.parentElement
    const onImage = before !== null && before.tagName === 'IMG' && before.hasAttribute('data-at')
    const onBlock =
      parent !== null && parent.hasAttribute('data-at') && parent.firstElementChild === label
    if (!onImage && !onBlock) {
      label.remove()
    }
  }

  for (const mark of timeMarks(root)) {
    const owner = mark.owner
    const beside = owner.tagName === 'IMG' ? owner.nextElementSibling : owner.firstElementChild
    const found =
      beside instanceof HTMLElement && beside.hasAttribute('data-at-label') ? beside : null
    const label = found ?? document.createElement('span')
    label.dataset.atLabel = '1'
    label.contentEditable = 'false'
    label.title = 'Hoppa dit i transkriptet'
    label.textContent = clock(mark.at)
    if (found === null) {
      if (owner.tagName === 'IMG') {
        owner.after(label)
      } else {
        owner.insertBefore(label, owner.firstChild)
      }
    }
  }
}

/**
 * The transcripts as the summary pass should read them, moments and all.
 *
 * A screenshot pasted at eleven minutes is a fact about the meeting that the
 * words do not carry - somebody put something on screen, and whatever was being
 * said around it mattered enough to keep. Threaded in at the right line it costs
 * one line of text and tells the model where to look.
 *
 * It says `(skärmbild)` and not what the picture showed, because nothing here
 * has seen it: the summary call sends text with its tools off. The instruction
 * says so as well, so the model does not fill the gap in.
 */
export function transcriptsWithMarks(root: HTMLElement): string {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('[data-recording], [data-transcript]')
  )
  const transcripts = blocks.filter((block) => block.hasAttribute('data-transcript'))
  const all = timeMarks(root)

  return transcripts
    .map((transcript) => {
      const at = blocks.indexOf(transcript)
      const before = at > 0 ? blocks[at - 1] : undefined
      const recording =
        before !== undefined && before.hasAttribute('data-recording')
          ? before.dataset.recording ?? ''
          : ''
      /*
       * With one transcript there is nothing to get wrong, so a mark whose
       * recording block has been deleted still lands. With several, a mark that
       * cannot name its own recording is left out rather than guessed at - a
       * screenshot filed under the wrong meeting is worse than one left out.
       */
      const mine =
        transcripts.length === 1
          ? [...all]
          : all.filter((mark) => mark.recording === recording && recording.length > 0)

      const lines: string[] = []
      const pending = [...mine]
      for (const line of transcript.querySelectorAll<HTMLElement>('p')) {
        const seconds = lineSeconds(line)
        while (pending.length > 0 && seconds !== null && pending[0].at <= seconds) {
          const mark = pending.shift()
          if (mark !== undefined) {
            lines.push(`[${clock(mark.at)}] ${mark.text}`)
          }
        }
        lines.push(line.textContent ?? '')
      }
      // Anything marked after the last spoken line still happened.
      for (const mark of pending) {
        lines.push(`[${clock(mark.at)}] ${mark.text}`)
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

/**
 * The two names a transcript labels its turns with, when it has any.
 *
 * Read back off the document rather than worked out a second time, so the
 * summary is told the same two names the person reading the note can see.
 */
export function transcriptSpeakers(
  root: HTMLElement
): { mine: string; theirs: string } | undefined {
  const named = (which: string): string =>
    root.querySelector<HTMLElement>(`[data-speaker="${which}"]`)?.textContent?.trim() ?? ''
  const mine = named('mine')
  const theirs = named('theirs')
  return mine.length > 0 && theirs.length > 0 ? { mine, theirs } : undefined
}

/**
 * A meeting's summary, as blocks the editor already understands.
 *
 * Action points are LISTED, never flagged. `data-action` marks them as the lines
 * the summary wrote; `data-alert`, which is what makes a line an action point on
 * the card and a promise with a clock on it in Tend, is put on by hand - one
 * gutter click each, or the control below for all of them at once.
 *
 * The other way round was the original design and it was wrong in the direction
 * that costs something. A meeting's summary flagged itself, on the reasoning that
 * a promise made out loud and left in a summary nobody reopens is not a promise.
 * What that actually produces is a list the model chose being promoted to a list
 * you are answerable for, before you have read it. A note's summary was already
 * exempt for a narrower version of the same reason - it turned "presented three
 * arguments" into an open promise - and the narrow version was the whole rule.
 * Deciding which lines are yours takes ten seconds and is not the summary's to
 * make.
 *
 * An implied commitment is marked as such rather than silently promoted. "I can
 * take a look at that" is a promise in effect, and the person reading it back
 * deserves to know the model inferred it rather than heard it.
 */
export function summaryHtml(
  provenance: { model: string; costUsd: number | null; filled?: number },
  value: {
    summary: string
    decisions: string[]
    actions: { text: string; implied: boolean }[]
    questions: string[]
    people: string[]
    lastTime?: string
  }
): string {
  const escape = (text: string): string =>
    text.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] ?? character)
  const parts: string[] = []

  parts.push('<h2>Sammanfattning</h2>')
  parts.push(`<p>${escape(value.summary)}</p>`)

  if (value.lastTime !== undefined && value.lastTime.trim().length > 0) {
    // First after the summary, deliberately: what was promised last time and is
    // still open is the thing a 1-1 most often fails to notice.
    parts.push('<h2>Sedan förra gången</h2>')
    parts.push(`<p>${escape(value.lastTime)}</p>`)
  }

  if (value.decisions.length > 0) {
    parts.push('<h2>Beslut</h2>')
    parts.push(`<ul>${value.decisions.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>`)
  }

  if (value.actions.length > 0) {
    parts.push('<h2>Åtgärdspunkter</h2>')
    for (const action of value.actions) {
      // `data-action` marks the line as one of these, whatever its flag state -
      // which is what lets the control below find exactly the lines it wrote,
      // rather than guessing from position under a heading.
      parts.push(
        `<p data-action="1">${escape(action.text)}` +
          (action.implied ? ' <em>(underförstått)</em>' : '') +
          '</p>'
      )
    }
    /*
     * One click for all of them, where you are already reading them.
     *
     * Nothing flags itself - see DECISIONS - and promoting them one gutter click
     * at a time is the right price for one and the wrong price for four. A modal
     * after the summary was the alternative and would arrive before the summary
     * had been read, showing the lines out of the context that decides whether
     * they are promises at all.
     *
     * Its label is written by `applySummaryBlocks`, so it says the right thing
     * after a reload too.
     */
    parts.push('<p data-flag-all="1"></p>')
  }

  if (value.questions.length > 0) {
    parts.push('<h2>Frågor jag inte ställde</h2>')
    parts.push(`<ul>${value.questions.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>`)
  }

  if (value.people.length > 0) {
    parts.push(`<p><em>Nämnda: ${value.people.map(escape).join(', ')}</em></p>`)
  }

  /*
   * Who wrote this, and what it cost.
   *
   * A summary that does not say which model produced it reads as if the note
   * wrote itself. It matters most when the answer is disappointing: the first
   * question is which tier ran, and without this the only way to find out is to
   * remember what the setting was at the time. The cost is there for the same
   * reason - it is the one part of this feature that spends anything.
   */
  const cost =
    provenance.costUsd === null || provenance.costUsd === undefined
      ? ''
      : ` · $${provenance.costUsd.toFixed(3)}`
  /*
   * And whether it wrote anywhere else.
   *
   * The summary sits at the top and is obviously the machine's. An answer filled
   * in under the note's own fifth heading is not obviously anything, and finding
   * one later without having been told is the moment you stop trusting which
   * words in the note are yours. One clause here is the whole remedy.
   */
  const filled =
    provenance.filled === undefined || provenance.filled === 0
      ? ''
      : ` · besvarade ${provenance.filled} ${provenance.filled === 1 ? 'fråga' : 'frågor'} i noteringen`
  parts.push(
    `<p data-provenance="1"><em>Sammanfattad med ${escape(provenance.model)}${cost}${filled}</em></p>`
  )

  return parts.join('')
}

/**
 * Everything in the note that the person wrote themselves.
 *
 * The transcript and any previous summary are left out: feeding a summary back
 * into the next one is how a note slowly becomes a summary of its own summaries.
 */
export function ownNotes(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement
  for (const generated of copy.querySelectorAll('[data-transcript], [data-recording], [data-summary]')) {
    generated.remove()
  }
  return (copy.textContent ?? '').replace(/\s{3,}/g, '\n\n').trim()
}

/*
 * ---------- the note's own questions ----------
 *
 * A templated note arrives with its questions already in it - the 1-1 template is
 * six headings with a prompt under each - and the summary used to ignore them
 * completely. It wrote its own four sections at the top and left the questions
 * sitting there unanswered, which is the one shape where a transcript and a note
 * are looking straight at each other and neither says so.
 *
 * So the questions are read out of the note, sent along with the transcript, and
 * the answers written back where they belong. The summary block is unchanged:
 * this is in ADDITION to it. What was decided and what you promised are still the
 * answer to "what happened"; this is the answer to "what did I mean to ask".
 *
 * ## The unit is the LINE, not the heading and not the question
 *
 * This is the part that decides whether the feature works, and it took being
 * told. A prompt line in the 1-1 template is not one question:
 *
 *   "Hur går det med det vi kom överens om förra gången? Något som behöver
 *    ändras, eller kan vi checka av det?"
 *
 * Two questions, one line, one place an answer can go. Splitting on the question
 * mark produces two half-answers to what a person asks as one thing. Keying on
 * the heading produces one answer where "Energi och friktion" holds two separate
 * lines - the fortnightly rotation, Vecka 1 and Vecka 2 - which are different
 * questions asked in different weeks.
 *
 * So: one answer per prompt line, covering every question on that line, written
 * under that line. The heading travels along as context and nothing more.
 *
 * ## Why the layout is worked out on a list of kinds
 *
 * Same split as `recordingInsertAt`: the decision is about order and adjacency,
 * not about elements, and `npm test` runs against `src/` with no DOM at all. So
 * the DOM is reduced to one kind per top-level child, the plan is computed from
 * that list, and only then is it read back into elements.
 */

/** What one top-level child of the note is, as far as its questions are concerned. */
export type PromptLineKind =
  /** A heading, which opens a section. */
  | 'heading'
  /** A heading that is itself a question - it ends in a question mark. */
  | 'asking-heading'
  /** A wholly-italic paragraph: how a template writes a prompt. */
  | 'prompt'
  /** An answer a previous pass wrote here. */
  | 'filled'
  /** Something the user wrote. */
  | 'text'
  /** A blank line. Carries nothing and never becomes an anchor. */
  | 'empty'

/** Where one question is, and where its answer goes. All indices into the list of kinds. */
export interface PromptPlan {
  /** The nth question in the note. The key an answer comes back under. */
  id: string
  /** The heading it sits under, or -1 for a question before any heading. */
  heading: number
  /** The prompt line, or the heading itself when the heading is the question. */
  question: number
  /** Insert the answer after this one. */
  anchor: number
  /** A previous pass's answers here, to be replaced rather than added to. */
  filled: number[]
  /** What the user wrote here. */
  existing: number[]
}

const OPENS_SECTION = (kind: PromptLineKind): boolean =>
  kind === 'heading' || kind === 'asking-heading'

/**
 * Where every question in the note is, and where each answer belongs.
 *
 * ## What counts as a question
 *
 * A wholly-italic paragraph. That is not a guess about intent - it is how both
 * shipped templates are written, and `story.ts` already reads the same shape back
 * to tell a half-captured story from a finished one.
 *
 * A heading ending in a question mark counts too, but only in a section holding
 * no italic line at all - somebody writing their own template as bare headings.
 * A fallback rather than a rule, because a question mark is a weak signal: inside
 * a section that has real prompt lines it would add a phantom question competing
 * with the ones actually written.
 *
 * The alternative to any signature was treating every heading as a question,
 * which fills in under "Anteckningar" and under a heading typed mid-meeting to
 * separate two topics - the model writing into structure that never asked
 * anything. Requiring the signature means a template written without italics is
 * not recognised, and that is the failure worth having: nothing happens, rather
 * than something unasked-for happening.
 *
 * ## Where the answer goes
 *
 * After the last thing the user wrote under that line, so it lands BELOW their
 * own words and never in place of them. That is the rule they chose, and it is
 * the same one the whole instruction runs on: what they typed while it was
 * happening is a judgement the transcript does not contain.
 *
 * A trailing blank line is not an anchor - an answer wedged under a blank reads
 * as belonging to the next question rather than to this one.
 */
export function promptLayout(kinds: PromptLineKind[]): PromptPlan[] {
  /** The note split at its headings. A note may open with prose and no heading. */
  const sections: { heading: number; from: number; to: number }[] = []
  let at = 0
  if (kinds.length > 0 && !OPENS_SECTION(kinds[0])) {
    while (at < kinds.length && !OPENS_SECTION(kinds[at])) {
      at += 1
    }
    sections.push({ heading: -1, from: 0, to: at })
  }
  while (at < kinds.length) {
    let to = at + 1
    while (to < kinds.length && !OPENS_SECTION(kinds[to])) {
      to += 1
    }
    sections.push({ heading: at, from: at + 1, to })
    at = to
  }

  const plans: PromptPlan[] = []
  const add = (heading: number, question: number, from: number, to: number): void => {
    const existing: number[] = []
    const filled: number[] = []
    let anchor = question
    for (let index = from; index < to; index += 1) {
      if (kinds[index] === 'text') {
        existing.push(index)
        anchor = index
      } else if (kinds[index] === 'filled') {
        filled.push(index)
      }
    }
    plans.push({ id: `q${plans.length + 1}`, heading, question, anchor, filled, existing })
  }

  for (const section of sections) {
    const lines: number[] = []
    for (let index = section.from; index < section.to; index += 1) {
      if (kinds[index] === 'prompt') {
        lines.push(index)
      }
    }

    if (lines.length > 0) {
      for (let which = 0; which < lines.length; which += 1) {
        const to = which + 1 < lines.length ? lines[which + 1] : section.to
        add(section.heading, lines[which], lines[which] + 1, to)
      }
      continue
    }

    if (section.heading !== -1 && kinds[section.heading] === 'asking-heading') {
      add(section.heading, section.heading, section.from, section.to)
    }
  }
  return plans
}

/** One top-level child, as a kind. */
export function promptLineKind(node: Element): PromptLineKind {
  const text = (node.textContent ?? '').trim()
  if (/^H[1-4]$/.test(node.tagName)) {
    return text.endsWith('?') ? 'asking-heading' : 'heading'
  }
  if (text.length === 0) {
    return 'empty'
  }
  if ('filled' in (node as HTMLElement).dataset) {
    return 'filled'
  }
  if (node.tagName === 'P') {
    const emphasised = Array.from(node.querySelectorAll('em, i'))
      .map((em) => (em.textContent ?? '').trim())
      .join(' ')
    // Not an exact match: a template that puts the trailing punctuation outside
    // the emphasis is the same shape and should not fall out over one character.
    if (emphasised.length >= text.length - 2) {
      return 'prompt'
    }
  }
  return 'text'
}

/** One prompt line found in the note. */
export interface NotePrompt {
  /** Position in the note, in document order. The key the answer comes back under. */
  id: string
  /** The heading it sits under, sent as context so the model knows what is asked about. */
  heading: string
  /** The line, verbatim. Usually more than one question, and answered as one thing. */
  question: string
  /** What the user already wrote under this line. Sent so the model adds rather than repeats. */
  existing: string
}

/**
 * The note's top-level children and their kinds, with the app's own blocks out.
 *
 * `blockKind` rather than a check on the node's own attributes, and that is the
 * whole reason this is a separate function. A transcript read back from disk
 * arrives wrapped in a paragraph - measured, not assumed - so the child standing
 * for it is a `p` whose text is nine thousand words of meeting. Left in, it
 * classifies as prose and gets counted as something the user wrote under the last
 * question above it: the answer would land beneath the entire transcript, and the
 * model would be told the user had already written the meeting out by hand.
 *
 * The summary block goes for the same reason from the other direction - its own
 * headings and lines are not questions, and it is not the note's structure.
 */
function scan(root: HTMLElement): { nodes: Element[]; kinds: PromptLineKind[] } {
  const nodes = Array.from(root.children).filter(
    (node) => blockKind(node as HTMLElement) === 'other'
  )
  return { nodes, kinds: nodes.map(promptLineKind) }
}

/**
 * The questions to ask about, as data to send.
 *
 * The note's own text goes with them, because the user's answer outranks the
 * transcript and a model that cannot see what they wrote restates it. Sending it
 * is what lets the instruction say "add what the conversation adds". A previous
 * pass's own answer is not in that set: it is not their judgement, and feeding it
 * back would have the model defer to itself.
 */
export function notePrompts(root: HTMLElement): NotePrompt[] {
  const { nodes, kinds } = scan(root)
  const text = (index: number): string => (nodes[index]?.textContent ?? '').trim()
  return promptLayout(kinds).map((plan) => ({
    id: plan.id,
    heading: plan.heading === -1 ? '' : text(plan.heading),
    question: text(plan.question),
    existing: plan.existing.map(text).join('\n')
  }))
}

/**
 * Write the answers back under the lines they answer.
 *
 * ## Matched by position, and dropped when it does not match
 *
 * The plan is re-read here rather than trusted from the request, and an id is the
 * nth question in the note. Re-reading is what makes the summary block landing at
 * the top between the two calls harmless, and it means an answer to a question
 * that has since been deleted finds nothing and is dropped rather than placed
 * somewhere plausible. A wrong section is worse than a missing one: it reads as
 * something the conversation established about the wrong subject.
 *
 * A re-run replaces its own last answer rather than stacking a second one.
 * Summarising twice is a real thing to do - the same transcript through a larger
 * model, or a second recording added to the note - and two answers under one
 * question is the note arguing with itself. Only paragraphs marked `data-filled`
 * are replaced, and nothing the user typed is in that set.
 *
 * Returns how many landed, which is what the summary's provenance line reports.
 */
export function fillAnswers(root: HTMLElement, answers: { id: string; answer: string }[]): number {
  const { nodes, kinds } = scan(root)
  const plans = new Map(promptLayout(kinds).map((plan) => [plan.id, plan]))
  let filled = 0

  for (const { id, answer } of answers) {
    const text = answer.trim()
    const plan = plans.get(id)
    if (text.length === 0 || plan === undefined) {
      continue
    }
    // Consumed, so a model answering the same id twice cannot write twice.
    plans.delete(id)

    for (const stale of plan.filled) {
      nodes[stale]?.remove()
    }

    const anchor = nodes[plan.anchor]
    if (anchor === undefined || anchor.parentElement === null) {
      continue
    }
    const paragraph = document.createElement('p')
    // `data-filled` is what says a human did not write this line - it is what the
    // styling hangs off, and what a re-run recognises as its own to replace.
    paragraph.dataset.filled = '1'
    paragraph.textContent = text
    anchor.parentElement.insertBefore(paragraph, anchor.nextSibling)
    filled += 1
  }
  return filled
}
