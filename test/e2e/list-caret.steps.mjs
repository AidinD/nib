/**
 * Tab and Shift+Tab in a list: the structure they leave, where the caret is
 * afterwards, and what Ctrl+Z brings back.
 *
 * The reported case first: type an item, Enter, Tab - and the caret jumped to
 * the start of the line above instead of staying in the item just indented.
 * Shift+Tab did the same. It was the repair after the browser's command: moving
 * the new sub-list into the item above takes the caret out of it, and whether a
 * repair was needed depended on the shape Chromium chose, which is why it
 * happened only sometimes. Every case below types a marker afterwards, because
 * where the next keystroke lands is what was wrong.
 *
 * Shift+Tab is also checked for order and undo: the old repair put the item
 * taken out BELOW the ones after it, and a fuller repair made Ctrl+Z lose
 * items. See lib/list-outdent.ts.
 *
 * And Backspace at the start of a list's first item, which takes the bullet off
 * rather than joining the line to the paragraph above.
 */

import { body, check, keys, openNote, setBody } from './editor.mjs'

export default async (page) => {
  await openNote(page)

  const fresh = async () => {
    await setBody(page, '<p>Start</p>', ['Start', 5])
    await page.enter()
  }

  // The reported case, exactly, in each kind of list - and with the save landing in between.
  for (const [kind, prefix, open] of [
    ['bullets', '- ', '<li>'],
    ['numbers', '1. ', '<li>'],
    ['checklist', '[ ] ', '<li·t>']
  ]) {
    await fresh()
    await page.type(`${prefix}den här funkar`)
    await page.enter()
    await page.tab()
    await page.sleep(900) // past the 600ms autosave, so a save after the move is part of the case
    await page.type('X')
    const after = await body(page)
    check(after.includes(`den här funkar<${kind === 'numbers' ? 'ol' : 'ul'}>${open}X</li>`), `${kind}: Enter, Tab, wait for the save - typing lands in the indented item`, after)

    await page.tab(true)
    await page.type('Y')
    const back = await body(page)
    check(back.includes(`</li>${open}XY</li>`), `${kind}: Shift+Tab straight after - back at the top, caret still in the item`, back)
  }

  // An item that already has text keeps the caret where it was in that text.
  await fresh()
  await page.type('- one')
  await page.enter()
  await page.type('two')
  await page.key(37, 'ArrowLeft', 'ArrowLeft')
  await page.tab()
  await page.type('X')
  check((await body(page)).includes('<li>one<ul><li>twXo</li></ul></li>'), 'Tab keeps the caret mid-text', await body(page))
  await page.tab(true)
  await page.type('Y')
  check((await body(page)).includes('<li>one</li><li>twXYo</li>'), 'Shift+Tab keeps it there too', await body(page))

  // Shift+Tab on a nested item: the order on screen never changes, and Ctrl+Z restores exactly.
  const three = '<ul><li>one<ul><li>a</li><li>b</li><li>c</li></ul></li><li>two</li></ul>'
  const outdents = [
    ['a', '<ul><li>one</li><li>aX<ul><li>b</li><li>c</li></ul></li><li>two</li></ul>'],
    ['b', '<ul><li>one<ul><li>a</li></ul></li><li>bX<ul><li>c</li></ul></li><li>two</li></ul>'],
    ['c', '<ul><li>one<ul><li>a</li><li>b</li></ul></li><li>cX</li><li>two</li></ul>']
  ]
  for (const [item, expected] of outdents) {
    await setBody(page, three, [item, 1])
    await page.tab(true)
    await page.type('X')
    check((await body(page)) === expected, `Shift+Tab on nested "${item}" keeps the order and the caret`, await body(page))

    await setBody(page, three, [item, 1])
    await page.tab(true)
    await keys.undo(page)
    check((await body(page)) === three, `Ctrl+Z after Shift+Tab on "${item}" restores the list exactly`, await body(page))
    await page.type('Y')
    check((await body(page)).includes(`<li>${item}Y</li>`), `and puts the caret back in "${item}"`, await body(page))
  }

  // A checklist item keeps its state through Shift+Tab.
  await setBody(page, '<ul><li data-task="open">one<ul><li data-task="done">a</li></ul></li></ul>', ['a', 1])
  await page.tab(true)
  check((await body(page)) === '<ul><li·t>one</li><li·x>a</li></ul>', 'a ticked nested step comes out still ticked', await body(page))

  // A top-level item becomes a paragraph between the two halves, never loose text.
  const flat = '<p>Start</p><ul><li>one</li><li>two</li><li>three</li></ul>'
  await setBody(page, flat, ['two', 1])
  await page.tab(true)
  await page.type('X')
  check((await body(page)) === '<p>Start</p><ul><li>one</li></ul><p>tXwo</p><ul><li>three</li></ul>', 'Shift+Tab on a top-level item makes a paragraph, caret kept', await body(page))
  await setBody(page, flat, ['two', 1])
  await page.tab(true)
  await keys.undo(page)
  check((await body(page)) === flat, 'and Ctrl+Z puts it back in the list', await body(page))

  // Tab is still the browser's command, and its own undo still works.
  await setBody(page, '<ul><li>one</li><li>two</li></ul>', ['two', 1])
  await page.tab()
  await keys.undo(page)
  check((await body(page)) === '<ul><li>one</li><li>two</li></ul>', 'Ctrl+Z after Tab restores the list', await body(page))

  // The first item cannot nest - it has nothing above it - and stays put.
  await setBody(page, '<ul><li>one</li><li>two</li></ul>', ['one', 1])
  await page.tab()
  await page.type('X')
  check((await body(page)) === '<ul><li>oXne</li><li>two</li></ul>', 'Tab on the first item changes nothing', await body(page))

  /*
   * Backspace at the start of a list's FIRST item takes the bullet off, and the
   * line stays where it is. It used to be joined to the paragraph above.
   */
  for (const [kind, list, item] of [
    ['bullets', 'ul', '<li>'],
    ['numbers', 'ol', '<li>'],
    ['checklist', 'ul', '<li data-task="open">']
  ]) {
    const start = `<p>Start</p><${list}>${item}one</li>${item}two</li></${list}>`
    const shown = start.replace(/ data-task="open"/g, '·t')
    const rest = `<${list}>${item.replace(' data-task="open"', '·t')}two</li></${list}>`

    await setBody(page, start, ['one', 0])
    await keys.backspace(page)
    await page.type('X')
    check((await body(page)) === `<p>Start</p><p>Xone</p>${rest}`, `${kind}: Backspace at the start of the first item makes it a paragraph, caret at its start`, await body(page))

    await setBody(page, start, ['one', 0])
    await keys.backspace(page)
    await keys.backspace(page)
    await page.type('X')
    // Chromium wraps the text it joins in a style-only span, on any paragraph join in
    // Nib; the sanitiser drops it on save, and it is not what this case is about.
    const joined = (await body(page)).replace(/<span style="[^"]*">([^<]*)<\/span>/g, '$1')
    check(joined === `<p>StartXone</p>${rest}`, `${kind}: a second Backspace joins it to the line above as usual`, joined)

    await setBody(page, start, ['one', 0])
    await keys.backspace(page)
    await keys.undo(page)
    check((await body(page)) === shown, `${kind}: Ctrl+Z puts the item back exactly`, await body(page))
    await page.type('Y')
    check((await body(page)).includes('Yone'), `${kind}: and the caret back at its start`, await body(page))
  }

  // An empty first item becomes an empty line, still in its place.
  await setBody(page, '<p>Start</p><ul><li><br></li><li>two</li></ul>', ['', 0])
  await keys.backspace(page)
  await page.type('X')
  check((await body(page)) === '<p>Start</p><p>X</p><ul><li>two</li></ul>', 'Backspace in an empty first item leaves an empty line in its place', await body(page))

  // A nested first item goes one level out, its siblings under it, the caret at its start.
  const nestedFirst = '<ul><li>one<ul><li>a</li><li>b</li></ul></li></ul>'
  await setBody(page, nestedFirst, ['a', 0])
  await keys.backspace(page)
  await page.type('X')
  check((await body(page)) === '<ul><li>one</li><li>Xa<ul><li>b</li></ul></li></ul>', 'Backspace at the start of a nested first item takes it one level out', await body(page))
  await setBody(page, nestedFirst, ['a', 0])
  await keys.backspace(page)
  await keys.undo(page)
  check((await body(page)) === nestedFirst, 'and Ctrl+Z puts it back in', await body(page))

  // Only the FIRST item, and only at its very start: everywhere else Backspace is the browser's.
  await setBody(page, '<ul><li>one</li><li>two</li></ul>', ['two', 0])
  await keys.backspace(page)
  await page.type('X')
  check((await body(page)) === '<ul><li>oneXtwo</li></ul>', 'Backspace at the start of a later item still joins it to the one above', await body(page))
  await setBody(page, '<ul><li>one</li><li>two</li></ul>', ['one', 1])
  await keys.backspace(page)
  await page.type('X')
  check((await body(page)) === '<ul><li>Xne</li><li>two</li></ul>', 'Backspace inside the first item deletes a character as usual', await body(page))
}
