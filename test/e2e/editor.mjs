/**
 * Shared moves for the regression scripts: open the note, set its body, put the
 * caret somewhere exact, and say where the caret is.
 *
 * What it is for: every case in these scripts is "this body, the caret here,
 * these keys, then the body and the caret should be that". Writing the setup
 * by hand in each case is how a script ends up testing its own setup instead.
 *
 * The caret is reported the cheap and honest way - by typing a marker and
 * reading where it landed - rather than from the Selection object. A selection
 * can sit on a position that is never where the next keystroke goes (on the
 * outer list, between two items), and the keystroke is what the person sees.
 */

export function check(condition, label, detail = '') {
  if (!condition) {
    throw new Error(`CHECK FAILED: ${label}\n      ${detail}`)
  }
  console.log(`  ok  ${label}`)
}

/** Open the scratch note and wait for its body. */
export async function openNote(page) {
  await page.waitFor(`document.querySelector('.card') !== null`)
  await page.click('.card')
  await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes('Start')`)
}

/** The body's HTML, with checklist states shortened so a line fits in a message. */
export function body(page) {
  return page.eval(`return document.querySelector('.doc-body').innerHTML.replace(/ data-task="open"/g, '·t').replace(/ data-task="done"/g, '·x')`)
}

/**
 * Replace the body and put the caret at `[text, offset]` - the text node whose
 * whole content is `text`. An empty `text` means the first empty item.
 */
export function setBody(page, html, [text, offset]) {
  return page.eval(`
    const root = document.querySelector('.doc-body'); root.innerHTML = ${JSON.stringify(html)}; root.focus()
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = null
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.textContent === ${JSON.stringify(text)}) { node = n; break }
    if (node === null) node = [...root.querySelectorAll('li')].find((li) => li.textContent === '')
    const range = document.createRange(); range.setStart(node, ${offset}); range.collapse(true)
    getSelection().removeAllRanges(); getSelection().addRange(range)
    return true`)
}

/** Put the caret at the end of the body's first paragraph. */
export function caretAfterFirstLine(page) {
  return page.eval(`
    const root = document.querySelector('.doc-body'); root.focus()
    const range = document.createRange(); range.selectNodeContents(root.querySelector('p')); range.collapse(false)
    getSelection().removeAllRanges(); getSelection().addRange(range)
    return true`)
}

export const keys = {
  backspace: (page) => page.key(8, 'Backspace', 'Backspace'),
  undo: (page) => page.key(90, 'KeyZ', 'z', 2),
  tick: (page) => page.key(13, 'Enter', 'Enter', 2 | 8),
  checklist: (page) => page.key(57, 'Digit9', '(', 2 | 8)
}
