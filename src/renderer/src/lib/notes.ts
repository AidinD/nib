import DOMPurify from 'dompurify'
import type { Category, NoteMeta } from '@shared/types'

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
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ],
  ALLOWED_ATTR: ['href', 'title', 'src', 'alt', 'class', 'data-canvas', 'data-w'],
  // The custom scheme is how a stored image is referenced; data: is what a paste
  // arrives as before it has been written to the assets folder.
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/|nib-asset:)/i
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG)
}

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

/** The stored width of an image, or its natural width when it has none yet. */
export function imageWidth(image: HTMLImageElement): number {
  const stored = Number(image.dataset.w)
  return Number.isFinite(stored) && stored > 0 ? stored : image.naturalWidth
}

/** A note's plain text, used for previews, word counts and search. */
export function htmlToText(html: string): string {
  const holder = document.createElement('div')
  holder.innerHTML = sanitizeHtml(html)
  return (holder.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * The card preview: the note's block elements joined with a middle dot, as the
 * design spec specifies, rather than the first N characters of a run-on string.
 * Blocks read as separate thoughts that way even at two lines.
 */
export function buildPreview(html: string): string {
  const holder = document.createElement('div')
  holder.innerHTML = sanitizeHtml(html)
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
  return category.notes.filter((note) => note.subId === subId).length
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
