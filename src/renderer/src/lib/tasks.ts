/**
 * Checklists: a list whose items can be ticked off.
 *
 * What it is for: a to-do list or a step-by-step procedure written inside a note,
 * where each step is ticked as it is done and stays ticked after a restart.
 *
 * ## How an item is stored
 *
 * `<li data-task="open">` or `<li data-task="done">`, in an ordinary `ul`. The
 * state lives on the ITEM, not on the list, because that is what survives the
 * browser's own editing commands: Tab moves the `li` into a new `ul` it creates
 * itself, Enter clones the `li` to make the next one, and a list-level marker
 * would be lost on the first of those and need re-deriving. A data attribute,
 * because that is what the sanitiser lets through - see `applyImageWidths`.
 *
 * ## Why the box is drawn by CSS and not an `<input type="checkbox">`
 *
 * The same reason the alert flag is (DECISIONS, 2026-08-23): a real control in a
 * contenteditable is content - selectable, deletable halfway, and something the
 * caret can land beside. Here the box is the list item's marker, drawn by the
 * stylesheet from the attribute, and a click in the marker's place toggles it.
 *
 * This is not the alert flag over again, and does not contradict the decision
 * that the flag is "a flag, not a checkbox". That decision was about marking any
 * line as needing attention, where a column of empty boxes would have claimed
 * every line was a task. A checklist is the opposite case: the author wrote a
 * list of steps, and the box is exactly what they asked for. The two coexist - a
 * checklist item can carry a flag like any other line.
 *
 * Rejected: a separate list of states in the index, keyed by position. Text
 * moves as a note is edited, and a position is stale the moment a line is added
 * above it. *
 * Reading a checklist as text (`[ ]` and `[x]`) lives in notes.ts, beside the
 * rest of reading a note as text: that file is loaded by the tests without a
 * bundler, so it cannot import this one.
 */

export type TaskState = 'open' | 'done'

/**
 * The state a typed prefix asks for, or null when it is not one.
 *
 * `[]`, `[ ]` and `[x]`, as markdown writes a task. The space inside the brackets
 * may arrive as a non-breaking space: Chromium turns a space typed at the end of
 * a text node into `&nbsp;` so it stays visible, and only converts it back when
 * something follows - which is not guaranteed by the time `]` is typed.
 */
export function taskPrefixState(before: string): TaskState | null {
  const match = /^\[([\s ]?|[xX])\]$/.exec(before)
  if (match === null) {
    return null
  }
  return /[xX]/.test(match[1]) ? 'done' : 'open'
}

/** What a click or Ctrl+Shift+Enter does to an item: open becomes done, anything else open. */
export function nextTaskState(current: string | undefined): TaskState {
  return current === 'open' ? 'done' : 'open'
}

/** A rectangle in viewport coordinates - the part of `DOMRect` the hit test uses. */
export interface Box {
  left: number
  top: number
  bottom: number
}

/**
 * Whether a point is on an item's box.
 *
 * The box is drawn where a bullet would be: in the `indent` to the left of the
 * item's own box, level with its FIRST line. Only the first line, because an
 * item holding a sub-list is as tall as all of it, and a click beside a
 * sub-item must reach the sub-item rather than tick its parent.
 *
 * Two pixels of slack on the right, so a click that lands a hair inside the
 * text still counts as aiming for the box.
 */
export function onTaskBox(item: Box, lineHeight: number, indent: number, x: number, y: number): boolean {
  return (
    x >= item.left - indent &&
    x <= item.left + 2 &&
    y >= item.top &&
    y <= Math.min(item.bottom, item.top + lineHeight)
  )
}

/**
 * The checklist item whose box is under the pointer, if any.
 *
 * Asked of every task item rather than of the click target: the box is drawn in
 * the list's padding, so the target is the `ul` or the parent item, never the
 * item the box belongs to. The last match wins, which is the innermost one.
 */
export function taskAtPoint(root: HTMLElement, x: number, y: number): HTMLElement | null {
  let hit: HTMLElement | null = null
  for (const item of root.querySelectorAll<HTMLElement>('li[data-task]')) {
    const list = item.parentElement
    const indent = list === null ? 22 : parseFloat(getComputedStyle(list).paddingLeft) || 22
    const lineHeight = parseFloat(getComputedStyle(item).lineHeight) || 24
    if (onTaskBox(item.getBoundingClientRect(), lineHeight, indent, x, y)) {
      hit = item
    }
  }
  return hit
}

/** Tick an item off, or un-tick it. */
export function toggleTask(item: HTMLElement): void {
  item.dataset.task = nextTaskState(item.dataset.task)
}

/**
 * The list items a selection touches, or the one the caret is in.
 *
 * Only items whose own first line is in the range: a selection inside a
 * sub-list also intersects the parent item, and turning the parent into a task
 * because a sub-item was selected would be a surprise.
 */
export function itemsInSelection(root: HTMLElement, range: Range): HTMLElement[] {
  if (range.collapsed) {
    const from =
      range.startContainer instanceof HTMLElement
        ? range.startContainer
        : range.startContainer.parentElement
    const item = from?.closest<HTMLElement>('li') ?? null
    return item !== null && root.contains(item) ? [item] : []
  }
  return Array.from(root.querySelectorAll<HTMLElement>('li')).filter((item) =>
    Array.from(item.childNodes).some(
      (child) =>
        !(child instanceof HTMLElement && (child.tagName === 'UL' || child.tagName === 'OL')) &&
        range.intersectsNode(child)
    )
  )
}
