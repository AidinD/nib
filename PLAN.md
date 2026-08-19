# Nib - plan

Last reconciled: 2026-08-19.

## Status

**Prepared, not implemented.**
The repository holds the design spec and the reasoning; there is no application code yet.

What exists:

- The design spec in [docs/design-spec.md](docs/design-spec.md), distilled from the Claude Design mock.
- The decisions taken so far in [DECISIONS.md](DECISIONS.md).
- No `package.json`, no source tree, no build. That is the next step and is deliberately not done yet.

## What Nib is

A desktop note-taking app that sits beside Jot rather than inside it.
Jot holds todos; Nib holds notes.
Same feel, same local-first approach, separate app and separate data.

## Requirements

These come from the author's own list, captured before any design work.

| Requirement | Covered by the mock |
| --- | --- |
| Same shape as Jot, with the list on the left | Yes |
| Real formatting (headings, emphasis, lists, quotes, code) | Yes |
| Paste images directly into the document, not as attachments | Yes |
| Sub-categories, e.g. `Manager meeting > February > note` | **No** - the mock has two levels |
| Sticky notes | **No** |
| Canvas drawing with a pressure-sensitive stylus (stretch goal) | **No** |

## Scope for the first version

In:

- The three-pane shell and editor exactly as specified in the design spec.
- Persistence to disk, with notes surviving restarts.
- Inline images.
- Categories with one level of sub-categories.

Out, for now:

- Sticky notes. They are a different window model (small, always-on-top, one note each) and are cleaner to add once the note store exists.
- Stylus canvas. A stretch goal, and the largest unknown in the whole project.
- Sync beyond whatever the storage folder itself syncs.

## Next steps

1. Scaffold the app: Electron + electron-vite + React + TypeScript, mirroring Jot's project layout.
2. Build the storage layer first, since it decides the shape of everything above it.
3. Build the three-pane shell against the design spec.
4. Build the editor, then inline images.
5. Revisit sub-categories in the sidebar once two levels are actually on screen.

## Open questions

- **Where does the data live?** The storage format is decided (see DECISIONS.md), the location is not. Jot uses an environment variable pointing into Dropbox; Nib can do the same, but the default for a public repo should be sensible for someone who is not the author.
- **Sub-category depth.** One level below a category covers the stated example. Arbitrary nesting is more general and more work, and nothing has asked for it yet.
- **Does anything move between Jot and Nib?** Turning a note into a todo, or attaching a note to a todo, is an obvious pull once both exist. Not planned yet.
