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

- **Nothing deletes without asking**: notes, categories and sub-categories all confirm first.
- **Three panes**: a three-level sidebar on the left (smart lists, categories, sub-categories), the note list in the middle, the editor on the right.
- **Real formatting**: headings, bold, italic, underline, strikethrough, inline code, bullet and numbered lists, quotes, dividers.
- **Images inline**: paste, drop or insert. They are stored beside the notes and referenced, not embedded, and a selected image can be resized or removed.
- **Sub-categories**, one level deep, so a note can live under `Manager meeting › February`. Drag a note onto a row to move it.
- **Sticky notes**: pinning a note opens a small always-on-top window bound to the same file, and pinned notes get their windows back on start.
- **Alerts**: every line has a marker in the document's margin - click it to flag the line as an action point, again to tick it off, again to clear it. Cards carry the same flag for notes that are themselves the action. Everything outstanding shows in a strip under the header and in a "Needs you" list.
- **A canvas** in a note: pen, highlighter and eraser, with stroke width driven by stylus pressure. Stored as strokes plus a rendered image.
- **Local-first**: one folder of plain JSON files, no server, and it syncs by living in a synced folder.

## Running it

```
npm install
npm run dev        # the app, with the renderer hot-reloaded
npm run typecheck  # both TypeScript projects
npm run build      # compile without packaging
```

## Building an installer

```
npm run package
```

Produces `dist/Nib Setup <version>.exe`, a Windows NSIS installer that can be
installed per-user without administrator rights. It is not code-signed, so
Windows will warn on first run.

The icon is committed under `resources/`; regenerate it with
`node scripts/generate-icon.mjs` if it ever changes.

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
