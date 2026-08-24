import { execFileSync, execSync } from 'child_process'
import { readFileSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

/*
 * Publish a release: clean, build, package, upload.
 *
 * A script rather than an npm script chain, for three reasons Jot learned the
 * hard way (its CLAUDE.md and DECISIONS carry the scars):
 *
 *  - `out/` and `dist/` MUST be cleared first. electron-builder happily packages
 *    whatever is already sitting in `out/`, so skipping the clean can ship the
 *    previous build's code under a new version number without a word of
 *    complaint. Jot published a release that way on 2026-08-04.
 *  - The upload has to be electron-builder's own publisher. It renames the
 *    installer to the dashed form that `latest.yml` references; a hand-made
 *    `gh release create` upload gets a name with spaces or dots instead, and
 *    electron-updater then 404s on an asset in a release that "looks" published.
 *  - The token comes from the `gh` CLI at release time, so there is no long-lived
 *    GH_TOKEN sitting in a shell profile or a file anywhere.
 *  - The version must not already be released. Without that check this script
 *    runs to completion, prints "Published", and does nothing: electron-builder
 *    refuses to overwrite `latest.yml` on a release older than two hours, so the
 *    installer nobody replaced stays the one the updater offers. It happened on
 *    2026-08-24 - the whole Story bank release was a no-op that reported success.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const { version, name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
console.log(`Releasing ${name} ${version}`)

/*
 * Refuse a version already on GitHub.
 *
 * This is the guard, and it has to come before anything is built. electron-builder
 * treats an existing release older than two hours as untouchable and skips
 * `latest.yml` with a notice in the middle of its output, then exits 0 - so the
 * failure looks exactly like a success and the updater keeps offering the old
 * build. Tend's script has had this check; this one did not.
 */
try {
  const existing = execSync(`gh release view v${version} --json tagName`, {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
  if (existing.trim().length > 0) {
    console.error(
      `
v${version} is already released on GitHub. Bump the version in package.json,
` +
        'commit, and run this again. Publishing over it would upload the installer and
' +
        'silently skip latest.yml, which leaves the updater on the old build.'
    )
    process.exit(1)
  }
} catch {
  // No such release, which is what we want.
}

function run(command, args, env) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: true, env })
}

for (const directory of ['out', 'dist']) {
  rmSync(join(root, directory), { recursive: true, force: true })
}
console.log('Cleaned out/ and dist/')

run('npx', ['electron-vite', 'build'], process.env)

// The already-authenticated gh CLI is the token source; nothing is stored.
let token
try {
  token = execSync('gh auth token', { cwd: root, encoding: 'utf-8' }).trim()
} catch {
  console.error('Could not get a token from `gh auth token` - is the gh CLI logged in?')
  process.exit(1)
}
if (token.length === 0) {
  console.error('`gh auth token` returned nothing.')
  process.exit(1)
}

run('npx', ['electron-builder', '--win', '--publish', 'always'], { ...process.env, GH_TOKEN: token })
console.log('Published. The installed app picks the new version up on its next launch.')
