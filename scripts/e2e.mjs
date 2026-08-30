import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

/*
 * Drive the app for real, without touching the mouse.
 *
 * The obvious way to test a desktop app is to move the pointer and click things,
 * and it is the wrong way: it fights whoever is using the machine, it steals
 * focus, and every coordinate is a guess that goes stale the moment a toolbar
 * wraps. This talks to the running renderer over the Chrome DevTools Protocol
 * instead - synthetic input into the page, and the DOM itself to check the
 * result.
 *
 * Usage:
 *
 *   node scripts/e2e.mjs <steps-file.mjs> [--keep]
 *
 * The steps file default-exports `async (page) => { ... }` and gets `eval`,
 * `click`, `type`, `waitFor` and `log`. The app is started with its own data
 * directory (NIB_DATA_DIR, which the caller sets) and shut down afterwards
 * unless --keep is passed.
 *
 * It launches its OWN instance and kills only that process. Never kill by name:
 * the installed app's process is also called Nib, and killing it closes the app
 * someone is working in.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
/*
 * The debugging port, overridable because it is shared ground.
 *
 * The sibling projects were all built from this file and all picked 9333, so a
 * Helm run and a Nib run at the same time collide - and the collision is quiet:
 * Chromium logs "Cannot start http server for devtools" and carries on, our own
 * `findPage` then finds the OTHER app's window on the port, and the steps drive
 * it. A steps file that clicks a delete button would have clicked Helm's.
 * Refusing to start beats attaching to a stranger's renderer.
 */
const PORT = Number(process.env.NIB_E2E_PORT ?? 9333)

/** Whether anything already answers on the debugging port. */
async function portTaken() {
  try {
    await fetch(`http://127.0.0.1:${PORT}/json/version`)
    return true
  } catch {
    return false
  }
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

async function findPage() {
  // The main window, not a sticky: stickies carry a #sticky/<id> hash.
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await response.json()
      const page = targets.find(
        (target) => target.type === 'page' && !target.url.includes('#sticky/')
      )
      if (page !== undefined) {
        return page
      }
    } catch {
      // The port is not up yet.
    }
    await sleep(250)
  }
  throw new Error('The renderer never appeared on the debugging port')
}

async function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  await new Promise((done, fail) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', () => fail(new Error('CDP socket failed')), { once: true })
  })

  let nextId = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (waiter !== undefined) {
      pending.delete(message.id)
      waiter(message)
    }
  })

  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = nextId++
      pending.set(id, (message) => {
        if (message.error !== undefined) {
          fail(new Error(`${method}: ${message.error.message}`))
        } else {
          done(message.result)
        }
      })
      socket.send(JSON.stringify({ id, method, params }))
    })

  return { socket, send }
}

function makePage(send) {
  /** Evaluate an expression in the renderer and return its value. */
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      /*
       * An ASYNC wrapper, so a step can `await` inside it.
       *
       * It used to be a plain arrow, and anything with an await in it failed with
       * "await is only valid in async functions" - which reads like a mistake in
       * the step file rather than a limit of the harness. `awaitPromise` below
       * already unwraps whatever this returns, so nothing else changes.
       */
      expression: `(async () => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true
    })
    if (result.exceptionDetails !== undefined) {
      throw new Error(`eval failed: ${result.exceptionDetails.exception?.description ?? 'unknown'}`)
    }
    return result.result.value
  }

  /**
   * Click an element by selector, at its centre, with real mouse events.
   *
   * Not `element.click()`: that skips mousedown, and several controls in this app
   * depend on it - the toolbar buttons deliberately swallow mousedown to keep the
   * caret, and the alert marker is a click in the line's margin.
   */
  const click = async (selector, offset = { x: 0, y: 0 }) => {
    const box = await evaluate(`
      const element = document.querySelector(${JSON.stringify(selector)})
      if (element === null) { return null }
      const rect = element.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    `)
    if (box === null) {
      throw new Error(`No element matched ${selector}`)
    }
    const point = { x: Math.round(box.x + offset.x), y: Math.round(box.y + offset.y) }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type,
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount: 1
      })
      await sleep(30)
    }
    await sleep(150)
  }

  /**
   * Press one of the mouse's side buttons.
   *
   * `back` and `forward` are real button values in the protocol, and they arrive
   * in the page as buttons 3 and 4 - so the navigation gesture can be tested
   * without touching the machine's actual mouse.
   */
  const sideButton = async (which) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type,
        x: 400,
        y: 400,
        button: which,
        buttons: type === 'mousePressed' ? (which === 'back' ? 8 : 16) : 0,
        clickCount: 1
      })
      await sleep(30)
    }
    await sleep(200)
  }

  /**
   * Press at one point, move to another, release - as pointer events.
   *
   * `mousePressed` / `mouseMoved` / `mouseReleased` arrive in the page as pointer
   * events too, which is what a splitter listens to. Several intermediate moves
   * rather than one jump: a handle that reads the pointer's travel needs
   * something to travel through.
   */
  const drag = async (fromX, fromY, toX, toY, steps = 8) => {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: fromX, y: fromY, button: 'left', buttons: 1, clickCount: 1
    })
    for (let step = 1; step <= steps; step++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(fromX + ((toX - fromX) * step) / steps),
        y: Math.round(fromY + ((toY - fromY) * step) / steps),
        button: 'left',
        buttons: 1
      })
      await sleep(20)
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: toX, y: toY, button: 'left', buttons: 0, clickCount: 1
    })
    await sleep(150)
  }

  /** Right-click a point, for a context menu. */
  const rightClick = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type,
        x: Math.round(x),
        y: Math.round(y),
        button: 'right',
        buttons: type === 'mousePressed' ? 2 : 0,
        clickCount: 1
      })
      await sleep(30)
    }
    await sleep(150)
  }

  /** Move the pointer to a point - to hover something, or to hover nothing. */
  const moveTo = async (x, y) => {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x),
      y: Math.round(y),
      buttons: 0
    })
    await sleep(150)
  }

  /** Click a point, for the parts of the app that ARE a point - the flag column. */
  const clickAt = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', {
        type,
        x: Math.round(x),
        y: Math.round(y),
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount: 1
      })
      await sleep(30)
    }
    await sleep(150)
  }

  /**
   * Move the pointer over an element, so `:hover` rules apply.
   *
   * A synthetic mouseMoved, not the desktop cursor - the real pointer belongs to
   * whoever is using the machine. Anything that only appears on hover needs this
   * before a screenshot will show it.
   */
  const hover = async (selector, offset = { x: 0, y: 0 }) => {
    const box = await evaluate(`
      const element = document.querySelector(${JSON.stringify(selector)})
      if (element === null) { return null }
      const rect = element.getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    `)
    if (box === null) {
      throw new Error(`No element matched ${selector}`)
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(box.x + offset.x),
      y: Math.round(box.y + offset.y),
      buttons: 0
    })
    await sleep(150)
  }

  /** Type into whatever has focus. */
  const type = async (text) => {
    for (const character of text) {
      await send('Input.dispatchKeyEvent', { type: 'char', text: character })
      await sleep(15)
    }
  }

  /**
   * Press a key, optionally with modifiers (1 alt, 2 ctrl, 4 meta, 8 shift).
   *
   * `text` is what separates a key the page merely observes from one that edits:
   * Enter dispatched as a bare rawKeyDown reaches a keydown handler but inserts
   * nothing, so a test of Enter-in-a-list quietly typed everything into one
   * bullet. Pass the character - a carriage return - and Chromium performs the
   * edit as well.
   */
  const key = async (windowsVirtualKeyCode, code, keyName, modifiers = 0, text = null) => {
    for (const type of [text === null ? 'rawKeyDown' : 'keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type,
        windowsVirtualKeyCode,
        code,
        key: keyName,
        modifiers,
        ...(text !== null && type === 'keyDown' ? { text, unmodifiedText: text } : {})
      })
      await sleep(30)
    }
    await sleep(120)
  }

  /** Enter, as an edit rather than as an observation. */
  const enter = async () => key(13, 'Enter', 'Enter', 0, '\r')

  /** Tab, or Shift+Tab. */
  const tab = async (shift = false) => key(9, 'Tab', 'Tab', shift ? 8 : 0)

  /** Wait until an expression returns something truthy. */
  const waitFor = async (expression, label = expression, seconds = 9) => {
    /*
     * Nine seconds by default, which is right for anything the app does on its
     * own. A model call is not that - it can take minutes - so the budget is a
     * parameter rather than a constant, and a test that waits for one says so.
     */
    for (let attempt = 0; attempt < Math.ceil((seconds * 1000) / 150); attempt++) {
      if (await evaluate(`return (${expression})`)) {
        return true
      }
      await sleep(150)
    }
    throw new Error(`Timed out waiting for: ${label}`)
  }

  /**
   * Screenshot the page, or a region of it, to a file.
   *
   * The other half of not using the pointer: a check that is about how something
   * looks still needs an image, and this is one taken from inside the renderer
   * rather than off the desktop - so it cannot catch another window by accident.
   */
  const shot = async (path, clip = null, scale = 2) => {
    const params = { format: 'png' }
    if (clip !== null) {
      params.clip = { ...clip, scale }
    }
    const result = await send('Page.captureScreenshot', params)
    writeFileSync(path, Buffer.from(result.data, 'base64'))
    console.log(`wrote ${path}`)
  }

  return {
    eval: evaluate,
    click,
    clickAt,
    rightClick,
    drag,
    hover,
    moveTo,
    sideButton,
    type,
    key,
    enter,
    tab,
    waitFor,
    shot,
    log: console.log,
    sleep
  }
}

const stepsPath = process.argv[2]
if (stepsPath === undefined) {
  console.error('Usage: node scripts/e2e.mjs <steps-file.mjs> [--keep]')
  process.exit(1)
}

if (await portTaken()) {
  console.error(
    `Port ${PORT} is already serving a DevTools endpoint - another app's e2e run is on it.\n` +
      'Wait for it to finish, or set NIB_E2E_PORT to a free port.'
  )
  process.exit(1)
}

const electron = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env
})
child.stdout.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
child.stderr.on('data', (chunk) => {
  const text = String(chunk)
  // Chromium's GPU cache complaints say nothing about the app.
  if (!/gpu_disk_cache|disk_cache|GPU Cache/.test(text)) {
    process.stderr.write(`[app] ${text}`)
  }
})

let failure = null
try {
  const target = await findPage()
  const { socket, send } = await connect(target.webSocketDebuggerUrl)
  await send('Runtime.enable')
  const page = makePage(send)
  const steps = (await import(`file://${resolve(stepsPath)}`)).default
  await steps(page)
  socket.close()
  console.log('\nSteps completed.')
} catch (error) {
  failure = error
  console.error(`\nFAILED: ${error.message}`)
}

if (!process.argv.includes('--keep')) {
  child.kill()
}
process.exit(failure === null ? 0 : 1)
