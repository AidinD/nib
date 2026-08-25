/**
 * Drag and drop, on the browser's own HTML5 API.
 *
 * Jot reaches for @dnd-kit; Nib does not, and the reason is what it has to drag.
 * A note card is dropped on three different kinds of target in two different
 * panes - between cards, on a category row, on a sub-category row - and the
 * editor already handles native file drops for images. One API for all of it
 * beats a sortable-list library plus the native path side by side.
 */

export type DragPayload =
  | { kind: 'note'; noteId: string; categoryId: string }
  | { kind: 'category'; categoryId: string }
  /** A sub-category, which can reorder within its category or move to another. */
  | { kind: 'sub'; categoryId: string; subId: string }

export const DRAG_MIME = 'application/x-nib'

/**
 * The item currently being dragged.
 *
 * `dataTransfer` is deliberately unreadable during `dragover` - the spec calls it
 * protected mode - so a drop target cannot ask what it is about to receive while
 * deciding whether to accept it. Every native implementation keeps the payload
 * on the side for exactly this; `types` is all the event itself will say.
 */
let dragged: DragPayload | null = null

export function startDrag(event: React.DragEvent, payload: DragPayload): void {
  dragged = payload
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
  event.dataTransfer.effectAllowed = 'move'
}

export function endDrag(): void {
  dragged = null
}

/** What is being dragged, for a target deciding whether it wants it. */
export function draggedItem(): DragPayload | null {
  return dragged
}

/** The payload at drop time, when `dataTransfer` can be read again. */
export function readDrop(event: React.DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData(DRAG_MIME)
  if (raw.length === 0) {
    return dragged
  }
  try {
    return JSON.parse(raw) as DragPayload
  } catch {
    return dragged
  }
}

/**
 * Is the pointer in the top or the bottom half of this row? That is what decides
 * whether the dragged item lands before or after it.
 */
export function isAfterMidpoint(event: React.DragEvent, element: HTMLElement): boolean {
  const box = element.getBoundingClientRect()
  return event.clientY > box.top + box.height / 2
}

/**
 * Where an insertion marker sits: before a given id, or at the very end of the
 * list. Null means no marker.
 */
export type DropSlot = { before: string } | { before: null } | null

export function slotFor(event: React.DragEvent, element: HTMLElement, id: string, nextId: string | null): DropSlot {
  if (!isAfterMidpoint(event, element)) {
    return { before: id }
  }
  return nextId === null ? { before: null } : { before: nextId }
}

export function slotEquals(a: DropSlot, b: DropSlot): boolean {
  if (a === null || b === null) {
    return a === b
  }
  return a.before === b.before
}
