/**
 * Checklists in the running app: starting one every way there is, ticking,
 * Enter and Tab inside one, and the state surviving a save and a reload.
 *
 * The DOM half of test/tasks.test.mjs - that file checks the rules without a
 * document; this one checks that the browser's own editing commands, which do
 * most of the work in a list, leave a checklist as one.
 */

import { check } from './editor.mjs'

export default async (page) => {
  const html = () => page.eval(`return document.querySelector('.doc-body').innerHTML`)
  const caretAtEndOf = (selector) =>
    page.eval(`
      const el = document.querySelector(${JSON.stringify(selector)})
      const body = document.querySelector('.doc-body')
      body.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const s = getSelection(); s.removeAllRanges(); s.addRange(range)
      return true`)
  const openNote = async () => {
    await page.waitFor(`document.querySelector('.card') !== null`)
    await page.click('.card')
    await page.waitFor(`document.querySelector('.doc-body')?.textContent.includes('Start')`)
  }

  await openNote()
  check((await html()).includes('<li>Plain bullet</li>'), 'existing bullets load unchanged', await html())

  // 1. The input rule: "[ ] " on a fresh line.
  await caretAtEndOf('.doc-body > p')
  await page.enter()
  await page.type('[ ] ')
  let h = await html()
  check(/<li data-task="open">/.test(h), '"[ ] " starts a checklist item', h)
  check(!h.includes('[ ]'), 'the typed prefix is gone', h)
  await page.type('Buy milk')
  await page.enter()
  await page.type('Call the contractor')
  h = await html()
  check((h.match(/data-task="open"/g) ?? []).length === 2, 'Enter makes a second unticked item', h)

  // 2. Tick the first item by clicking its box.
  const box = await page.eval(`
    const li = document.querySelector('.doc-body li[data-task]')
    const r = li.getBoundingClientRect()
    return { x: r.left - 11, y: r.top + 12 }`)
  await page.clickAt(box.x, box.y)
  h = await html()
  check(/<li data-task="done">Buy milk/.test(h), 'clicking the box ticks it', h)
  const style = await page.eval(`
    const li = document.querySelector('.doc-body li[data-task="done"]')
    const cs = getComputedStyle(li)
    return { image: cs.listStyleImage, deco: cs.textDecorationLine, color: cs.color }`)
  check(style.image.includes('svg'), 'a ticked item draws the ticked box', style.image)
  check(style.deco.includes('line-through'), 'a ticked item is struck through', style.deco)
  const openStyle = await page.eval(`return getComputedStyle(document.querySelectorAll('.doc-body li[data-task]')[1]).listStyleImage`)
  check(openStyle.includes('svg') && openStyle !== style.image, 'an open item draws the open box', openStyle)
  const plain = await page.eval(`return getComputedStyle([...document.querySelectorAll('.doc-body li')].find(l => !l.dataset.task)).listStyleImage`)
  check(plain === 'none', 'an ordinary bullet keeps its bullet', plain)

  // 3. Enter after a ticked item: the new item is open, the ticked one stays ticked.
  await caretAtEndOf('.doc-body li[data-task="done"]')
  await page.enter()
  h = await html()
  console.log('    after Enter on a ticked item:', h)
  check(/<li data-task="done">Buy milk<\/li><li data-task="open">/.test(h), 'Enter on a ticked item makes an open one below it', h)
  await page.type('Between')

  // 4. Tab nests, Shift+Tab un-nests, and the item stays a task both ways.
  await page.tab()
  h = await html()
  check(/<li data-task="done">Buy milk<ul><li data-task="open">Between<\/li><\/ul><\/li>/.test(h), 'Tab nests a task under the one above', h)
  await page.tab(true)
  h = await html()
  check(/<\/li><li data-task="open">Between<\/li>/.test(h) && !/<ul><li data-task="open">Between/.test(h), 'Shift+Tab takes it back out', h)

  // 5. Ctrl+Shift+Enter ticks the item the caret is in.
  await page.key(13, 'Enter', 'Enter', 2 | 8)
  h = await html()
  check(/<li data-task="done">Between/.test(h), 'Ctrl+Shift+Enter ticks the caret item', h)
  await page.key(13, 'Enter', 'Enter', 2 | 8)
  check(/<li data-task="open">Between/.test(await html()), 'and un-ticks it', await html())

  // 6. Enter on an empty item leaves the list.
  await page.eval(`document.querySelectorAll('.doc-body li').forEach(l => { if (l.firstChild?.textContent === 'Call the contractor') l.id = 'last-task' }); return true`)
  await caretAtEndOf('#last-task')
  await page.eval(`document.getElementById('last-task').removeAttribute('id'); return true`)
  await page.enter()
  await page.enter()
  await page.type('After the list')
  h = await html()
  check(/<\/ul><p>After the list<\/p>/.test(h), 'Enter on an empty item leaves the list', h)
  check(!/data-task="[^"]*"[^>]*>After/.test(h), 'the paragraph after it carries no task state', h)

  // 7. "- " then "[x] " inside a bullet: the habit from markdown.
  await page.enter()
  await page.type('- ')
  await page.type('[x] ')
  await page.type('Already done')
  h = await html()
  check(/<li data-task="done">Already done<\/li>/.test(h), '"- [x] " makes a ticked item', h)

  // 8. Ctrl+Shift+9 toggles a line in and out of a checklist; the toolbar lights up.
  await page.enter()
  await page.enter()
  await page.type('Toggle me')
  await page.key(57, 'Digit9', '(', 2 | 8)
  h = await html()
  check(/<li data-task="open">Toggle me<\/li>/.test(h), 'Ctrl+Shift+9 makes a checklist', h)
  await page.sleep(200)
  const lit = await page.eval(`return [...document.querySelectorAll('.toolbar button.is-active')].map(b => b.textContent)`)
  check(lit.includes('Checklist') && !lit.includes('Bullets'), 'the Checklist button is lit, Bullets is not', JSON.stringify(lit))
  await page.key(57, 'Digit9', '(', 2 | 8)
  check(/<li>Toggle me<\/li>/.test(await html()), 'Ctrl+Shift+9 again turns it back into a bullet', await html())

  // 9. The slash menu offers it.
  await page.enter()
  await page.enter()
  await page.type('/check')
  await page.waitFor(`[...document.querySelectorAll('*')].some(e => e.children.length === 0 && e.textContent === 'Checklist' && !e.closest('.toolbar'))`, 'slash menu shows Checklist')
  await page.enter()
  await page.type('From the slash menu')
  check(/<li data-task="open">From the slash menu<\/li>/.test(await html()), 'the slash command makes a checklist', await html())

  // 10. Saved to disk.
  await page.sleep(1200)
  const disk = await page.eval(`return (await window.nib.readNote('note-e2e')).html`)
  console.log('    on disk:', disk)
  check(/<li data-task="done">Buy milk/.test(disk), 'the ticked state is on disk', disk)
  check(/<li data-task="open">Call the contractor/.test(disk), 'the open state is on disk', disk)
  const preview = await page.eval(`return document.querySelector('.card')?.textContent`)
  console.log('    card:', preview)
  check(!preview.includes('[x]'), 'the card preview carries no box markers')


  // 11. Reload the renderer, open the note again, and the state is drawn from disk.
  await page.eval(`location.reload(); return true`)
  await page.sleep(1500)
  await openNote()
  const after = await page.eval(`
    const items = [...document.querySelectorAll('.doc-body li[data-task]')]
    return items.map(li => ({ text: li.firstChild.textContent, state: li.dataset.task, image: getComputedStyle(li).listStyleImage.slice(0, 40) }))`)
  console.log('    after reload:', JSON.stringify(after))
  check(after.find((i) => i.text === 'Buy milk')?.state === 'done', 'Buy milk is still ticked after a reload')
  check(after.find((i) => i.text === 'Call the contractor')?.state === 'open', 'Call the contractor is still open after a reload')
  check(after.every((i) => i.image.includes('svg')), 'every item draws a box after reload')

  // 12. Untick by clicking again, then a click on the text does NOT tick.
  const textPoint = await page.eval(`
    const li = [...document.querySelectorAll('.doc-body li[data-task]')].find(l => l.firstChild.textContent === 'Call the contractor')
    const r = li.getBoundingClientRect()
    return { x: r.left + 40, y: r.top + 12 }`)
  await page.clickAt(textPoint.x, textPoint.y)
  check(/<li data-task="open">Call the contractor/.test(await html()), 'a click on the text does not tick')

}
