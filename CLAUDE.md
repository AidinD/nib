# Nib - project notes

Nib is a desktop note-taking app, a sibling to Jot (`D:\Repo\Tools\jot`) rather than a part of it.

## Do NOT point NIB_DATA_DIR at a scratch folder to test

It does the opposite of what the habit expects. `migrateLegacyData()` copies the
whole notebook - index, notes, assets, drawings - into any `NIB_DATA_DIR` that
has no index yet. That is correct for its actual job, relocating your data to a
synced folder, and it is a trap for testing: instead of isolating the run from
real notes, it **replicates real notes into the scratch directory**.

This happened. A dev run against a fresh scratch dir came up showing a real note
about a named colleague resigning, which is exactly the sort of content that must
not end up in a temp folder. It copies rather than moves, so nothing was lost -
and a copy of somebody's private notebook in `%TEMP%` is still a copy.

To test against fixtures, write the index and notes into the scratch directory
**first**, so `migrateLegacyData` sees an index and returns. Or test the pure
logic directly: `npm test` runs against `src/` with no app at all.

## Nib depends on keel

**keel** (github.com/AidinD/keel) is the suite's shared layer, linked as
`file:../keel` — so it must be checked out at `D:\Repo\Tools\keel`. It is a
devDependency, used by `npm run icon`, `npm run release`, and — since the atomic
write moved to `keel/storage` — by the app itself. A devDependency is still
right: electron-vite bundles, and `externalizeDepsPlugin` externalises
`dependencies` only, so keel's code is inlined into `out/main` rather than
resolved at runtime. Verified by grepping the built bundle; do that again if the
build config changes, because a keel import left external in a packaged app fails
with nothing in the log.

`npm install` does **not** fail when it is missing — npm 11 links a missing
`file:` dependency to a dangling symlink and exits 0. The failure arrives later
and quieter, as `ERR_MODULE_NOT_FOUND` from `npm run icon`.

Editing keel changes Nib immediately, with no rebuild step — that is the point of
it having no build. It also means a change there can break other siblings, so run
`npm test` in keel and `npm run icon` here before assuming it is fine. The icon
output is committed, and regenerating it is supposed to leave `resources/` with
an empty diff.

## Read these first

- [PLAN.md](PLAN.md) - current status, scope, next steps, open questions.
- [DECISIONS.md](DECISIONS.md) - what was decided and why, newest first.
- [docs/design-spec.md](docs/design-spec.md) - the visual and interaction spec the implementation is checked against.

Keep both PLAN.md and DECISIONS.md current as work happens, not in a batch at the end.

## Verifying a change in the running app

```
node scripts/e2e.mjs <steps-file.mjs>
```

The harness starts its own instance with `--remote-debugging-port`, drives the
renderer over the Chrome DevTools Protocol and reads the DOM back. Steps files
default-export `async (page) => {}` and get `eval`, `click`, `type`, `key`,
`waitFor`.

Do **not** verify by moving the pointer and clicking. It fights whoever is using
the machine, steals focus into their other windows, and every coordinate is a
guess that goes stale the moment a toolbar wraps - all three happened here on
2026-08-23 before this existed.

Two rules that come with it:

- **Never kill processes by name.** The installed app's process is called `Nib`, so `Stop-Process -Name Nib` closes the app someone is working in. Kill only the PID you started; `e2e.mjs` does exactly that.
- **Always point `NIB_DATA_DIR` at a scratch folder** for a test run, so a test never writes into real notes.

## Releases

A release is: **bump the version, commit, push, then publish** - in that order.

```
npm run release
```

That script cleans, builds, packages and uploads. Do not assemble it by hand; each
step is there because skipping it has broken a release in Jot, which shares this
setup:

- **The clean is not optional.** electron-builder packages whatever is already in `out/`, so building without clearing it ships the previous build's code under a new version number, silently. Jot published 1.5.30 that way on 2026-08-04.
- **The upload must be electron-builder's own publisher**, never `npm run package` (local installer only) and never a manual `gh release create`. `latest.yml` references the installer under a dashed name (`Nib-Setup-0.2.0.exe`); packaging locally produces spaces and a hand-made upload produces dots, and electron-updater then 404s on the asset in a release that looks fine. See Jot's DECISIONS, 2026-07-04.
- **A bad release is fixed by bumping, not by republishing.** electron-updater only offers an update when the version increases, so anyone who already took the bad X stays on it until X+1 exists.

The token comes from `gh auth token` at release time, so there is no long-lived
`GH_TOKEN` anywhere. The app itself needs no token to check for updates: the repo
is public.

Nib is unsigned. The first manual install trips SmartScreen; auto-updates after
that are silent, since electron-updater does not require signing for NSIS.

## Conventions

- Jot is the reference for project layout and build setup. When a structural question comes up, look at how Jot solved it before inventing something new.
- Nib is a separate application with its own data store. Do not reach into Jot's data.
- Task tracking lives in the Jot category **Note taking app**, bound to this repository via its `repoPath`.
