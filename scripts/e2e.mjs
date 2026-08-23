import { spawn } from 'child_process'
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
const PORT = 9333

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
      expression: `(() => { ${expression} })()`,
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

  /** Type into whatever has focus. */
  const type = async (text) => {
    for (const character of text) {
      await send('Input.dispatchKeyEvent', { type: 'char', text: character })
      await sleep(15)
    }
  }

  /** Press a key, optionally with modifiers (1 alt, 2 ctrl, 4 meta, 8 shift). */
  const key = async (windowsVirtualKeyCode, code, keyName, modifiers = 0) => {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type,
        windowsVirtualKeyCode,
        code,
        key: keyName,
        modifiers
      })
      await sleep(30)
    }
    await sleep(120)
  }

  /** Wait until an expression returns something truthy. */
  const waitFor = async (expression, label = expression) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await evaluate(`return (${expression})`)) {
        return true
      }
      await sleep(150)
    }
    throw new Error(`Timed out waiting for: ${label}`)
  }

  return { eval: evaluate, click, type, key, waitFor, log: console.log, sleep }
}

const stepsPath = process.argv[2]
if (stepsPath === undefined) {
  console.error('Usage: node scripts/e2e.mjs <steps-file.mjs> [--keep]')
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
