# Nib

A desktop note-taking app, built as a sibling to [Jot](https://github.com/AidinD/jot).

Jot captures todos.
Nib captures notes: longer-form, formatted, with images pasted straight into the
document and drawings made in it.

Status: **the first version is built.** Every requirement on the original list is
implemented and has been exercised against the running app.
See [PLAN.md](PLAN.md) for what is left and [DECISIONS.md](DECISIONS.md) for why
things are the way they are.

## What it does

- **Three panes**: a three-level sidebar on the left (smart lists, categories, sub-categories), the note list in the middle, the editor on the right.
- **Real formatting**: headings, bold, italic, underline, strikethrough, inline code, bullet and numbered lists, quotes, dividers.
- **Images inline**: paste, drop or insert. They are stored beside the notes and referenced, not embedded, and a selected image can be resized or removed.
- **Sub-categories**, one level deep, so a note can live under `Manager meeting › February`. Drag a note onto a row to move it.
- **Sticky notes**: pinning a note opens a small always-on-top window bound to the same file, and pinned notes get their windows back on start.
- **Alerts**: every line has a marker in the document's margin - click it to flag the line as an action point, again to tick it off, again to clear it. Cards carry the same flag for notes that are themselves the action. Everything outstanding shows in a strip under the header and in a "Needs you" list.
- **A canvas** in a note: pen, highlighter and eraser, with stroke width driven by stylus pressure. Stored as strokes plus a rendered image.
- **Local-first**: one folder of plain JSON files, no server, and it syncs by living in a synced folder.
- **Archive a note**: out of the way, not gone. An archived note leaves every list, every count and the alert strip, keeps its file and its category, and comes back from the Archive row in one click. Search leaves the archive alone - unless it holds matches you are not being shown, in which case it says so and offers them.
- **Nothing deletes without asking**: notes, categories and sub-categories all confirm first, in the app's own dialog, which says what goes with it - a category takes its sub-categories and every note inside them, a sub-category takes nothing.

## Running it

Nib depends on [**keel**](https://github.com/AidinD/keel), the shared layer under
the suite, linked from the filesystem — so it has to be checked out **next to**
this repo before `npm install` will work:

```
Tools/
├── nib/
└── keel/
```

```bash
git clone https://github.com/AidinD/keel ../keel
```

Without the sibling checkout `npm install` still **exits 0** — npm links
`file:../keel` to a dangling symlink and says nothing. What fails is the first
import: `npm run icon` and `npm run release` die with `ERR_MODULE_NOT_FOUND`, and
the build cannot resolve `keel/storage`. keel stays a devDependency because
electron-vite inlines it into the bundle rather than resolving it at runtime.

```
npm install
npm run dev        # the app, with the renderer hot-reloaded
npm run typecheck  # both TypeScript projects
npm run build      # compile without packaging
npm run icon       # regenerate resources/icon.png and icon.ico
```

## Building an installer

```
npm run package
```

Produces `dist/Nib Setup <version>.exe`, a Windows NSIS installer that can be
installed per-user without administrator rights. It is not code-signed, so
Windows will warn on first run.

## Releasing

```
npm run release
```

Bump the version in `package.json` first, commit and push, then run this: it
cleans, builds, packages and publishes a GitHub release, and the installed app
picks the new version up on its next launch. The upload uses a token from the
`gh` CLI, so there is nothing to configure and nothing stored.

The icon is committed under `resources/`; regenerate it with
`node scripts/generate-icon.mjs` if it ever changes. It draws two marks - the
full nib for 48px and up, just the tip and a drop of ink for 16 and 32 - and
packs both into a multi-size `icon.ico`.

## Where the data lives

By default in Electron's `userData` folder (`%APPDATA%/nib` on Windows), so a
fresh install works with no setup.

Set `NIB_DATA_DIR` to put it somewhere else - a synced folder, for instance. That
is per-machine configuration, never baked into the app; the first start after
setting it moves any existing data across.

```
index.json      Categories, sub-categories and note metadata. No note bodies.
notes/<id>.json One file per note: its title and its HTML body.
drawings/<id>.json  One file per drawing: its strokes.
assets/         Pasted images and rendered drawings, named by content hash.
```

## Repository layout

```
src/main       The Electron main process: windows, storage, IPC
src/preload    The one bridge the renderer gets
src/renderer   The React app - both window types share one bundle
src/shared     The data model and the data-directory layout
docs/design-spec.md  The visual and interaction spec, distilled from the Claude Design mock
PLAN.md              Current status, what is verified, and what is next
DECISIONS.md         Decisions made and the reasoning behind them
```

## License

MIT. See [LICENSE](LICENSE).
