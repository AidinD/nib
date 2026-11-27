/**
 * Run the editor's regression scripts against the real app, each in a fresh
 * scratch notebook.
 *
 * What it is for: the editor's behaviour lives in Chromium's editing engine as
 * much as in this code - where a list command leaves the caret, what an insert
 * does next to an element that cannot be edited - and none of that runs under
 * `npm test`, which has no document. These scripts drive the built app through
 * scripts/e2e.mjs and fail loudly when a case regresses.
 *
 *   npm run build
 *   node test/e2e/run.mjs [name-filter]
 *
 * Each script gets its own notebook in the temp folder, written BEFORE the app
 * starts. That order is the point: `migrateLegacyData` copies the real notebook
 * into any NIB_DATA_DIR that has no index yet (see CLAUDE.md), so a scratch
 * folder must already hold one when the app first looks at it.
 *
 * Rejected: one shared notebook for all scripts. A failed script leaves the note
 * in whatever state it failed in, and the next one would start from that.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const filter = process.argv[2] ?? ''

const START = '<p>Start</p><ul><li>Plain bullet</li></ul>'

/**
 * A notebook with one category and one note, `note-e2e`, whose body is a line
 * and a bullet - or the `seed` a script exports, for a case that is about what
 * the app does with a note as it is loaded.
 */
function scratchNotebook(dir, html = START) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'notes'), { recursive: true })
  const now = Date.now()
  const meta = {
    id: 'note-e2e', categoryId: 'cat-e2e', subId: null, title: 'E2E', preview: 'Start',
    created: now, edited: now, pinned: false, tint: '', alerts: [], links: [], flag: '', kind: '',
    tags: [], archived: false, hasImage: false, hasDrawing: false
  }
  writeFileSync(join(dir, 'index.json'), JSON.stringify({
    version: 2,
    categories: [{ id: 'cat-e2e', name: 'E2E', color: 'blue', scope: '', open: true, subs: [], notes: [meta] }],
    tags: []
  }))
  writeFileSync(join(dir, 'notes', 'note-e2e.json'), JSON.stringify({
    id: 'note-e2e', categoryId: 'cat-e2e', subId: '', title: 'E2E',
    html, created: now, edited: now
  }))
}

const scripts = readdirSync(here).filter((name) => name.endsWith('.steps.mjs') && name.includes(filter))
let failed = 0
for (const name of scripts) {
  const notebook = join(tmpdir(), `nib-e2e-notebook-${process.pid}`)
  // A script may seed the note's body, or write a whole notebook of its own -
  // still into the scratch folder, still before the app starts.
  const { seed, notebook: write } = await import(pathToFileURL(join(here, name)).href)
  if (typeof write === 'function') {
    rmSync(notebook, { recursive: true, force: true })
    mkdirSync(join(notebook, 'notes'), { recursive: true })
    write(notebook)
  } else {
    scratchNotebook(notebook, seed)
  }
  console.log(`\n=== ${name}`)
  const run = spawnSync(process.execPath, [join(root, 'scripts', 'e2e.mjs'), join(here, name)], {
    cwd: root,
    env: { ...process.env, NIB_DATA_DIR: notebook },
    encoding: 'utf8'
  })
  const lines = `${run.stdout}${run.stderr}`.split('\n')
  // The app's own chatter is noise here; the script's lines and the verdict are
  // not, and neither is quick record's - it is how a script sees the hotkey.
  console.log(lines.filter((line) => (!line.startsWith('[app]') || line.includes('[quick]')) && !/DevTools listening|^\s+at /.test(line)).join('\n'))
  if (run.status !== 0) {
    failed++
  }
  rmSync(notebook, { recursive: true, force: true })
}
console.log(failed === 0 ? `\nAll ${scripts.length} passed.` : `\n${failed} of ${scripts.length} FAILED.`)
process.exit(failed === 0 ? 0 : 1)
