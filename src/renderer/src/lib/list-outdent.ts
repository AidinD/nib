/**
 * Shift+Tab in a list, done by hand, with an undo of its own.
 *
 * What it is for: taking a list item one level out without changing the order
 * of anything in the note, without losing the caret, and in a way Ctrl+Z can
 * take back exactly.
 *
 * ## Why not `document.execCommand('outdent')`
 *
 * Chromium's `outdent` writes shapes HTML does not allow. On a nested item it
 * leaves `<li>one<ul>a</ul><li>b</li><ul>c</ul></li>` - an item inside an item -
 * and on a top-level one it leaves the text loose under the body, in no block,
 * wrapped in `<span style="color: var(--text)">`. Both had to be repaired
 * afterwards by moving nodes, and that is where it went wrong:
 *
 *  - The repair of the nested shape lifted the item out and left the items that
 *    followed it behind, so Shift+Tab on the middle of three read one, a, c, b.
 *  - Repairing it properly - carrying those items along - made Ctrl+Z lose text.
 *    The browser's undo replays its own `outdent` backwards against the nodes it
 *    remembers, and once the repair has moved them, the replay put things back
 *    in the wrong places and dropped some: undoing Shift+Tab on the first of
 *    three nested items left only "one". Measured in the running app.
 *
 * A command whose output has to be rearranged cannot also be undone by the
 * thing that only knows the command. So the move is made here, in one go, into
 * a valid shape, and it records exactly what it moved so it can move it back.
 * The same trade the editor already made for Enter on an empty item (DECISIONS,
 * 2026-08-24): one step off the browser's undo stack, held by the editor instead.
 *
 * ## The rule
 *
 * A nested item moves out to sit after the item it was under, and the items
 * that followed it come along as its own sub-items - the order on screen never
 * changes. A top-level item becomes a paragraph between two halves of the list,
 * its own sub-items following it as a list. The item element itself is kept for
 * a nested move, so its attributes - a checklist state, an alert flag - come
 * with it untouched.
 */

/** Moves the DOM back to how it was before an outdent. */
export type UndoOutdent = () => void

function isList(node: Element | null): node is HTMLElement {
  return node !== null && (node.tagName === 'UL' || node.tagName === 'OL')
}

/** The item's own sub-list, if it ends with one. */
function ownSubList(item: HTMLElement): HTMLElement | null {
  const last = item.lastElementChild
  return isList(last) ? last : null
}

/** Take a nested item one level out. Null when it is not nested. */
export function outdentNested(item: HTMLElement): UndoOutdent | null {
  const list = item.parentElement
  const parentItem = list?.parentElement ?? null
  if (!isList(list) || parentItem === null || parentItem.tagName !== 'LI') {
    return null
  }
  const listNext = list.nextSibling
  const itemNext = item.nextSibling

  const following: Element[] = []
  for (let node = item.nextElementSibling; node !== null; node = node.nextElementSibling) {
    following.push(node)
  }
  let created: HTMLElement | null = null
  let target = ownSubList(item)
  if (following.length > 0 && target === null) {
    created = document.createElement(list.tagName.toLowerCase())
    item.appendChild(created)
    target = created
  }
  for (const node of following) {
    target?.appendChild(node)
  }
  parentItem.after(item)
  const listRemoved = list.childElementCount === 0
  if (listRemoved) {
    list.remove()
  }

  return () => {
    if (listRemoved) {
      parentItem.insertBefore(list, listNext)
    }
    for (const node of following) {
      list.appendChild(node)
    }
    created?.remove()
    list.insertBefore(item, itemNext !== null && itemNext.parentNode === list ? itemNext : (following[0] ?? null))
  }
}

/**
 * Take a top-level item out of its list, as a paragraph.
 *
 * Returns the paragraph, for the caret, and the undo. Null when the item is
 * nested, or the list is inside something that is not the body's own flow.
 */
export function outdentTopLevel(item: HTMLElement): { paragraph: HTMLElement; undo: UndoOutdent } | null {
  const list = item.parentElement
  if (!isList(list) || list.parentElement === null || list.parentElement.tagName === 'LI') {
    return null
  }
  const listParent = list.parentElement
  const listNext = list.nextSibling
  const itemNext = item.nextSibling

  const paragraph = document.createElement('p')
  const ownNodes: ChildNode[] = []
  const subLists: HTMLElement[] = []
  for (const node of Array.from(item.childNodes)) {
    if (node instanceof HTMLElement && isList(node)) {
      subLists.push(node)
    } else {
      ownNodes.push(node)
    }
  }
  paragraph.append(...ownNodes)
  if ((paragraph.textContent ?? '').length === 0 && paragraph.querySelector('img, br') === null) {
    paragraph.appendChild(document.createElement('br'))
  }

  const trailing: Element[] = []
  for (let node = item.nextElementSibling; node !== null; node = node.nextElementSibling) {
    trailing.push(node)
  }
  const rest = trailing.length > 0 ? document.createElement(list.tagName.toLowerCase()) : null
  rest?.append(...trailing)

  item.remove()
  list.after(paragraph, ...subLists, ...(rest === null ? [] : [rest]))
  const listRemoved = list.childElementCount === 0
  if (listRemoved) {
    list.remove()
  }

  const undo: UndoOutdent = () => {
    if (listRemoved) {
      listParent.insertBefore(list, listNext)
    }
    // Only the nodes this moved out of the item go back; a <br> it added does not.
    item.append(...ownNodes, ...subLists)
    list.append(...trailing)
    list.insertBefore(item, itemNext !== null && itemNext.parentNode === list ? itemNext : (trailing[0] ?? null))
    paragraph.remove()
    rest?.remove()
  }
  return { paragraph, undo }
}
