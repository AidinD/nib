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
 * `data-state` where it is in the journey from audio to transcript.
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
    block.textContent =
      state === 'working'
        ? `Recording · ${length} · transcribing…`
        : state === 'transcribed'
          ? `Recording · ${length} · transcribed`
          : `Recording · ${length} · ${language} · click to transcribe`
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
    if ((wrapper as HTMLElement).dataset.canvas !== undefined) {
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
 */
export function transcriptHtml(
  segments: { start: string; end: string; text: string }[],
  minutes: number
): string {
  const escape = (text: string): string =>
    text.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] ?? character)
  const lines = segments
    .filter((segment) => segment.text.length > 0)
    .map(
      (segment) =>
        `<p><em>${segment.start.replace(/^00:/, '')}</em> ${escape(segment.text)}</p>`
    )
    .join('')
  return (
    `<details data-transcript="1">` +
    `<summary>Transkript · ${minutes} min · ${segments.length} avsnitt</summary>` +
    (lines.length > 0 ? lines : '<p><em>Ingenting hördes.</em></p>') +
    `</details>`
  )
}
