import { execFileSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { appMeta, clean, ghToken, nodeExec, preflight } from 'keel/release'

/*
 * Publish a release: check, clean, build, package, upload.
 *
 * The guards come from `keel/release`, which is where they belong: they are a
 * list of things that went wrong in one of the sibling apps, and four private
 * copies meant this script was missing two of them. It shipped a release on
 * 2026-08-24 that did nothing and reported success, because it had no
 * already-released check - and it never checked the working tree at all, so the
 * published build did not have to match any commit.
 *
 * What stays here is Nib's own middle: the build command, and the fact that both
 * `out/` and `dist/` have to go. `out/` is not optional - electron-builder
 * packages whatever is sitting there without complaint, so a skipped clean ships
 * the previous build's code under a new version number. Jot published exactly
 * that on 2026-08-04.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const exec = nodeExec(root)
const { name, version, tag } = appMeta(root)
console.log(`Releasing ${name} ${version}`)

function fail(message) {
  console.error(`\n${message}`)
  process.exit(1)
}

function run(command, args, env) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: true, env })
}

// Before anything is built. electron-builder treats an existing release older
// than two hours as untouchable and skips `latest.yml` with a notice in the
// middle of its output, then exits 0 - so the failure looks exactly like a
// success and the updater keeps offering the old build.
const failures = preflight(exec, { tag, checks: ['cleanTree', 'nothingUnpushed', 'notAlreadyReleased'] })
if (failures.length > 0) {
  fail(failures.map((failure) => failure.message).join('\n\n'))
}

try {
  clean(root, ['out', 'dist'])
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

run('npx', ['electron-vite', 'build'], process.env)

// The already-authenticated gh CLI is the token source; nothing is stored, so
// there is no long-lived GH_TOKEN in a shell profile to leak.
let token
try {
  token = ghToken(exec)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

// electron-builder's own publisher, not `gh release create`: it names the
// installer in the dashed form `latest.yml` references, and a hand-made upload
// gets a name with spaces that electron-updater then 404s on.
run('npx', ['electron-builder', '--win', '--publish', 'always'], { ...process.env, GH_TOKEN: token })
console.log('Published. The installed app picks the new version up on its next launch.')
