# Nib - plan

Last reconciled: 2026-08-19.

## Status

**Design settled, implementation starts the week of 2026-08-24.**
The repository holds the design spec and the reasoning; there is no application code yet.

What exists:

- The design spec in [docs/design-spec.md](docs/design-spec.md), distilled from the Claude Design mock. It now covers all three surfaces: the main window, the sticky windows, and the drawing canvas.
- The decisions taken so far in [DECISIONS.md](DECISIONS.md).
- No `package.json`, no source tree, no build. That is the next step.

## What Nib is

A desktop note-taking app that sits beside Jot rather than inside it.
Jot holds todos; Nib holds notes.
Same feel, same local-first approach, separate app and separate data.

## Requirements

These come from the author's own list, captured before any design work.
All six are now covered by the mock.

| Requirement | Covered by the mock |
| --- | --- |
| Same shape as Jot, with the list on the left | Yes, and restyled to Jot's own tokens |
| Real formatting (headings, emphasis, lists, quotes, code) | Yes |
| Paste images directly into the document, not as attachments | Yes |
| Sub-categories, e.g. `Manager meeting > February > note` | Yes |
| Sticky notes | Yes, as their own artboard |
| Canvas drawing with a pressure-sensitive stylus (stretch goal) | Yes, drawing for real off `event.pressure` |

## Scope for the first version

In:

- The main window exactly as specified in the design spec: three panes, three-level sidebar, editor.
- Persistence to disk, with notes surviving restarts.
- Inline images.
- Sticky windows.

Out, for now:

- The stylus canvas. The mock proves the interaction works, which was the open question; wiring it to real storage is a second decision (stroke data, a rendered image, or both) and it should not hold up the rest.
- Sync beyond whatever the storage folder itself syncs.

## Next steps

1. Scaffold the app: Electron + electron-vite + React + TypeScript, mirroring Jot's project layout.
2. Build the storage layer first, since it decides the shape of everything above it.
3. Build the three-pane shell against the design spec, sidebar included.
4. Build the editor, then inline images.
5. Add sticky windows, which need a second window type in the main process.
6. Then the canvas, once there is somewhere to put a drawing.

## Open questions

- **Where does the data live?** The storage format is decided (see DECISIONS.md), the location is not. Jot uses an environment variable pointing into Dropbox; Nib can do the same, but the default for a public repo should be sensible for someone who is not the author.
- **Sub-category depth.** One level below a category covers the stated example. Arbitrary nesting is more general and more work, and nothing has asked for it yet.
- **Does anything move between Jot and Nib?** Turning a note into a todo, or attaching a note to a todo, is an obvious pull once both exist. Not planned yet.
