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
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const filter = process.argv[2] ?? ''

/** A notebook with one category and one note, `note-e2e`, whose body is a line and a bullet. */
function scratchNotebook(dir) {
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
    html: '<p>Start</p><ul><li>Plain bullet</li></ul>', created: now, edited: now
  }))
}

const scripts = readdirSync(here).filter((name) => name.endsWith('.steps.mjs') && name.includes(filter))
let failed = 0
for (const name of scripts) {
  const notebook = join(tmpdir(), `nib-e2e-notebook-${process.pid}`)
  scratchNotebook(notebook)
  console.log(`\n=== ${name}`)
  const run = spawnSync(process.execPath, [join(root, 'scripts', 'e2e.mjs'), join(here, name)], {
    cwd: root,
    env: { ...process.env, NIB_DATA_DIR: notebook },
    encoding: 'utf8'
  })
  const lines = `${run.stdout}${run.stderr}`.split('\n')
  // The app's own chatter is noise here; the script's lines and the verdict are not.
  console.log(lines.filter((line) => !line.startsWith('[app]') && !/DevTools listening|^\s+at /.test(line)).join('\n'))
  if (run.status !== 0) {
    failed++
  }
  rmSync(notebook, { recursive: true, force: true })
}
console.log(failed === 0 ? `\nAll ${scripts.length} passed.` : `\n${failed} of ${scripts.length} FAILED.`)
process.exit(failed === 0 ? 0 : 1)
