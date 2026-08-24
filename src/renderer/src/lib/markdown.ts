/*
 * Markdown shortcuts, for the habits that are faster than reaching for a button.
 *
 * Two families, triggered at different moments:
 *
 *  - Block shortcuts fire on the SPACE that follows a prefix at the start of a
 *    line: `# `, `## `, `### `, `- `, `* `, `1. `, `> `.
 *  - Inline shortcuts fire on the character that CLOSES a pair: `**bold**`,
 *    `*italic*`, `_italic_`, `` `code` ``.
 *
 * And `---` on its own line, on Enter, becomes a divider.
 *
 * Everything here goes through `document.execCommand`, which is what the rest of
 * the editor uses (see the DECISIONS entry) and which has the useful property of
 * writing to the browser's own undo stack - so Ctrl+Z takes the formatting back
 * off and leaves the characters, which is what anyone who mistypes expects.
 *
 * Each function returns whether it consumed the keystroke. The caller swallows
 * the key when it did.
 */

import { normaliseLists } from './notes'

/** Where the caret is, when it is a plain collapsed caret in a text node. */
interface Caret {
  node: Text
  offset: number
  range: Range
  selection: Selection
}

function caretIn(root: HTMLElement): Caret | null {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) {
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
  return { node: node as Text, offset: range.startOffset, range, selection }
}

/** Select a stretch of one text node, so a command can act on exactly that. */
function selectRange(caret: Caret, from: number, to: number): void {
  const range = document.createRange()
  range.setStart(caret.node, from)
  range.setEnd(caret.node, to)
  caret.selection.removeAllRanges()
  caret.selection.addRange(range)
}

/**
 * The text of a block before a given node.
 *
 * Used to insist that a block shortcut's prefix really is at the START of the
 * line: `a - b` should stay as it is, and only a `- ` with nothing in front of it
 * should become a bullet.
 */
function textBefore(block: HTMLElement, node: Node): string {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let text = ''
  let current = walker.nextNode()
  while (current !== null && current !== node) {
    text += current.textContent ?? ''
    current = walker.nextNode()
  }
  return text
}

const BLOCK_SHORTCUTS: Array<{ prefix: RegExp; run: () => void }> = [
  { prefix: /^###$/, run: () => document.execCommand('formatBlock', false, 'h3') },
  { prefix: /^##$/, run: () => document.execCommand('formatBlock', false, 'h2') },
  { prefix: /^#$/, run: () => document.execCommand('formatBlock', false, 'h1') },
  { prefix: /^[-*+]$/, run: () => document.execCommand('insertUnorderedList') },
  { prefix: /^\d{1,3}[.)]$/, run: () => document.execCommand('insertOrderedList') },
  { prefix: /^>$/, run: () => document.execCommand('formatBlock', false, 'blockquote') }
]

/**
 * Turn a line-start prefix into a block, on the space that follows it.
 *
 * Skipped inside a list item: `- ` in a bullet is someone writing a dash, and
 * nesting is Tab's job. Skipped inside code, where the characters mean
 * themselves.
 */
export function applyBlockShortcut(root: HTMLElement, blockOfCaret: HTMLElement | null): boolean {
  const caret = caretIn(root)
  if (caret === null || blockOfCaret === null) {
    return false
  }
  if (blockOfCaret.tagName === 'LI' || caret.node.parentElement?.closest('code, pre') != null) {
    return false
  }

  const before = (caret.node.textContent ?? '').slice(0, caret.offset)
  if (textBefore(blockOfCaret, caret.node).length > 0) {
    return false
  }

  const shortcut = BLOCK_SHORTCUTS.find((candidate) => candidate.prefix.test(before))
  if (shortcut === undefined) {
    return false
  }

  // Take the prefix out first, so the block is left holding only real text.
  selectRange(caret, caret.offset - before.length, caret.offset)
  document.execCommand('delete')
  shortcut.run()
  // A list built on an empty paragraph ends up inside it; put it where it goes
  // before anything reads the note back.
  normaliseLists(root)
  return true
}

/** Longest delimiter first, so `**` wins over `*`. */
const INLINE_SHORTCUTS = [
  { delimiter: '**', tag: 'strong' },
  { delimiter: '`', tag: 'code' },
  { delimiter: '*', tag: 'em' },
  { delimiter: '_', tag: 'em' }
]

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Close an inline pair and format what is between.
 *
 * `typed` is the character about to be inserted - the closing one - which is not
 * in the DOM yet, so it is appended to the text before the caret to see whether
 * it completes a pair.
 *
 * The guards are what keep arithmetic and prose out of it: the content cannot be
 * empty, cannot begin or end with a space, and cannot contain the delimiter
 * itself. `2 * 3 * 4` stays as it is; `*emphasis*` does not.
 *
 * Only within a single text node. A pair split across nodes - because half of it
 * is already bold, say - is left alone rather than half-handled.
 */
export function applyInlineShortcut(root: HTMLElement, typed: string): boolean {
  const caret = caretIn(root)
  if (caret === null || caret.node.parentElement?.closest('code, pre') != null) {
    return false
  }

  const line = (caret.node.textContent ?? '').slice(0, caret.offset) + typed

  for (const { delimiter, tag } of INLINE_SHORTCUTS) {
    if (!line.endsWith(delimiter)) {
      continue
    }
    const withoutClose = line.slice(0, line.length - delimiter.length)
    const openAt = withoutClose.lastIndexOf(delimiter)
    if (openAt === -1) {
      continue
    }
    const content = withoutClose.slice(openAt + delimiter.length)
    if (
      content.length === 0 ||
      content !== content.trim() ||
      content.includes(delimiter) ||
      content.includes('\n')
    ) {
      continue
    }

    /*
     * Do not let `*` steal the third asterisk of `**bold**`.
     *
     * Typing that, the star before the word closes a perfectly good single-star
     * pair as far as the rules above are concerned - so `**bold*` became
     * `*<em>bold</em>` and the fourth keystroke had nothing left to close. If the
     * opening delimiter is itself preceded by the same characters, this is half of
     * a longer pair and not ours.
     */
    if (withoutClose.slice(Math.max(0, openAt - delimiter.length), openAt) === delimiter) {
      continue
    }

    // The match runs from the opening delimiter to the caret; the closing one is
    // still only a keystroke, so it is not part of the range.
    selectRange(caret, openAt, caret.offset)
    document.execCommand(
      'insertHTML',
      false,
      `<${tag}>${escapeHtml(content)}</${tag}>` +
        // A zero-width space after the tag, so what is typed next lands outside
        // it. Without it the caret stays inside the strong and everything after
        // is bold too, which is the single most annoying way to get this wrong.
        '​'
    )
    return true
  }
  return false
}

/**
 * `---` alone on a line becomes a divider, on Enter.
 *
 * Built by hand rather than with `insertHorizontalRule`, which left the text
 * typed after it as a bare text node directly under the body - not inside any
 * block. Nothing in this editor can work with a line like that: the alert
 * marker, the markdown shortcuts and Tab all ask which block the caret is in,
 * and the answer was "none". So the rule is replaced by an `hr` and an empty
 * paragraph, and the caret is put in the paragraph.
 */
export function applyDividerShortcut(root: HTMLElement, blockOfCaret: HTMLElement | null): boolean {
  if (blockOfCaret === null || blockOfCaret.tagName === 'LI' || blockOfCaret === root) {
    return false
  }
  const text = (blockOfCaret.textContent ?? '').trim()
  if (text !== '---' && text !== '***') {
    return false
  }

  insertDivider(blockOfCaret, true)
  return true
}

/**
 * Put a divider in, and a paragraph after it for the caret.
 *
 * The button and the slash command both come here rather than to
 * `insertHorizontalRule`, which is where the loose-text bug came from: it left
 * everything typed after the rule as a bare text node under the body, in no
 * block at all, and every feature in this editor asks which block the caret is
 * in. `replace` is for the `---` shortcut, whose line is consumed by the rule.
 */
export function insertDivider(blockOfCaret: HTMLElement, replace = false): void {
  const rule = document.createElement('hr')
  const after = document.createElement('p')
  after.appendChild(document.createElement('br'))

  if (replace) {
    blockOfCaret.replaceWith(rule)
  } else {
    blockOfCaret.after(rule)
  }
  rule.after(after)

  const range = document.createRange()
  range.setStart(after, 0)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
