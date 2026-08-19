# Nib design spec

Distilled from an interactive Claude Design mock of the app.

The mock is a working prototype: it has real React logic behind it, not just a static layout.
This file captures what that prototype specifies so the implementation does not have to
re-derive it from the prototype's own runtime.

The mock is not checked in.
It depends on Claude Design's own runtime (`support.js`, the `x-dc` element, the `DCLogic`
base class), so a copy of the file would not run here anyway.
This spec is the durable artifact; the mock is the source it was read from.

## Window shell

Frameless window with a custom 34px title bar.

- Title bar background `#101014`, bottom border `#22222b`, draggable region.
- Left: a 13px rounded square with a `#6d78ff → #4f5bd5` gradient as the app mark, then the app name in `#9a9aac` at 12px.
- Right: minimise / maximise / close, each 46x34px. Close hovers to `#e04b4b` with white glyph; the others hover to `#22222b`.

## Layout

Three columns filling the remaining height.

| Pane | Width | Background |
| --- | --- | --- |
| Lists sidebar | 212px fixed | `#1a1a20` |
| Note list | 268px fixed | `#1d1d24` |
| Editor | fills | `#212128` |

Column separators are 1px `#24242d`.

## Palette

| Token | Value | Used for |
| --- | --- | --- |
| Base background | `#16161b` | App body, input fields |
| Title bar | `#101014` | Title bar, page backdrop |
| Accent | `#4f5bd5` | Selection borders, focus, drop indicators, active format buttons |
| Text primary | `#e6e6ee` | Body text |
| Text strong | `#f2f2f8` | Titles, selected items |
| Text muted | `#6e6e80` | Counts, metadata |
| Text dim | `#5c5c6c` | Placeholders |
| Border | `#2a2a34` / `#2e2e3a` | Cards, dividers |
| Danger | `#e07070` / `#3a2427` | Delete hover |

List colours cycle through `#5b8def`, `#4ec9a4`, `#e0b341`, `#8b7bf0`, `#ef6ba4`.

Base font size is 13px, system UI stack.
Editor body is 14.5px at line-height 1.72.

## Lists sidebar

Top to bottom:

1. **Wordmark** - app name at 17px/660 weight, with a small `notes v0.1` label beside it.
2. **All notes** and **Recent** rows, each with a right-aligned count (`Recent` shows `7d`).
3. **Lists** section header with a count.
4. **Scope filter** - a three-way segmented control: All / Work / Private. Selected segment gets `#2e2e3a` background.
5. **List rows**, scrollable.
6. **New list** input, dashed border, commits on Enter.

Each list row carries: a 7px colour dot, the name, a note count, a scope badge, an `edit` affordance, and a delete `✕`.
The `edit` and `✕` affordances sit at 0.3 opacity until the row is hovered.

Row interactions:

- Click selects the list and its first note.
- Double-click (or `edit`) starts an inline rename; Enter commits, Escape cancels, blur commits.
- Clicking the scope badge cycles it through none → Work → Private. Work renders `#5b8def`, Private `#ef6ba4`, none a dim `–`.
- Deleting a non-empty list asks for confirmation naming the list and its note count.
- Rows are draggable to reorder. Dropping a **note** onto a list moves the note into that list instead.

Drop feedback: a reorder target gets a 2px accent line on its top edge; a list receiving a note gets a full 2px accent outline.
The dragged item drops to 0.4 opacity.

## Note list

Header: the active list's colour dot, its name, and an `N notes` count on the right.
Below it a search field filtering the current list by title **and** body text.

Each note card shows:

- Title (falls back to `Untitled note`), truncated to one line, with a `✕` delete on the right.
- A two-line preview built from the note's block elements joined with `·`; empty notes read `Empty note`.
- A metadata row: relative edit time (`today`, `yesterday`, `3 days ago`, `2w ago`) and a `has image` marker in accent colour when the note contains an image.

The selected card gets background `#282833` and an accent border.
Cards are draggable to reorder within the list, or onto another list to move.

A dashed **New note** input sits below the cards and commits on Enter, inserting at the top.

## Editor

### Toolbar

One row, wrapping, on `#1e1e25`:

`H1` `H2` `H3` `Body` | `B` `I` `U` `S` `code` | `Bullets` `1. List` `Quote` `Divider` | `Insert image`

`B`/`I`/`U`/`S` light up in the accent colour while the caret sits in text with that formatting.
`Insert image` is styled as the one filled action: `#2b2d52` background, `#3d4189` border, `#cdd0ff` text.
Right-aligned at the end of the toolbar: the save state, reading `Saved` or `Saving…`.

### Document

Centred column with a configurable measure (default 760px, adjustable 600-1100px), 34px top padding and 120px bottom padding.

- Title: a borderless 29px/660 input, placeholder `Untitled note`.
- Metadata row: list colour dot and name, word count, `edited <relative time>`, and a `· private` tag in pink when the list is scoped Private.
- Body: the editable document itself, minimum height 420px.

Body typography inside the document: `h1` 26px, `h2` 20px `#dcdcea`, `h3` 16px `#c3c3d4`, paragraphs with a 10px bottom margin.
Blockquotes get a 2px accent left border and italic `#a9a9bd` text.
Inline code gets a `#26262f` chip with a `#32323e` border.
Images get an 8px radius and a `#2e2e3a` border, capped at the column width.

### Images

Images arrive by paste, by drag-and-drop onto the document, or via `Insert image`.
Clicking an image selects it - accent outline, 2px offset - and a floating toolbar appears just above it with **Remove image**, **Smaller** (x0.8) and **Larger** (x1.25).
Escape or clicking elsewhere deselects.
Backspace or Delete while an image is selected removes it.
Scaling clamps to a minimum width of 80px and keeps `max-width: 100%`.

### Saving and shortcuts

Typing marks the note unsaved and schedules a save 600ms later; the state label reflects this.
`Cmd/Ctrl+Enter` saves immediately.
`Cmd/Ctrl+Shift+8` inserts a bullet list.
`Cmd/Ctrl+B` and `Cmd/Ctrl+I` are the platform defaults, surfaced in the status bar hint.

## Status bar

A 28px bar at the bottom of the editor pane on `#1a1a20`.
Left: the shortcut hint.
Right: where the notes live, shown in the mock as `Local vault · ~/Jot/notes`.

## Adjustable in the mock

The mock exposes three properties, which are worth keeping as real settings:

- **Accent colour** - `#4f5bd5` (default), `#4ec9a4`, `#e0b341`, `#ef6ba4`.
- **Measure** - the editor column width, 600-1100px in 20px steps, default 760.
- **Serif body** - switches the document font to `Iowan Old Style, Georgia, serif`.

## What the mock does not cover

Tracked in PLAN.md, listed here so the gap against the mock is explicit:

- **Sub-categories.** The mock has two levels (list → note). The requirement is three (`Manager meeting > February > note`).
- **Sticky notes.**
- **Canvas drawing with a pressure-sensitive stylus** (a stretch goal, not part of the first version).
- **Persistence.** The mock keeps everything in memory; nothing is written to disk.
