# Nib design spec

Distilled from the interactive Claude Design mock of the app (artboard `Nib`).

The mock is a working prototype with real React logic behind it, not a static layout.
This file captures what that prototype specifies so the implementation does not have to
re-derive it from the prototype's own runtime.

The mock itself is not checked in.
It depends on Claude Design's runtime to render, so a copy would not open here.
This spec is the durable artifact; the mock is the source it was read from.

The mock is one canvas holding three artboards: the main window, the sticky windows, and
the canvas block open for drawing.

## Design system

Nib uses Jot's tokens verbatim, so the two apps read as one family.

| Token | Value | Used for |
| --- | --- | --- |
| `--bg` | `#1b1c1f` | Window background, inset fields, the drawing surface |
| `--surface` | `#26282c` | Note cards, the editor panel, sticky windows |
| `--surface-hover` | `#2f3237` | Card hover, selected card |
| `--surface-alt` | `#2a2c31` | Inline code chips, the pressure readout |
| `--border` | `#36393f` | Panel and card borders, dividers, sub-category row hover |
| `--text` | `#e8e9ec` | Body text |
| `--text-dim` | `#9a9da3` | Counts, metadata, inactive toolbar buttons |
| `--accent` | `#6f9cff` | Selection, focus, drop markers, the pressure meter |
| `--danger` | `#ff6b6b` | Delete affordances |
| `--amber` | `#ffb054` | Sticky notes |
| `--green` | `#5fd0a0` | A category colour, an ink colour |
| `--violet` | `#b98cff` | Drawing blocks, a category colour |

Typeface is `'Segoe UI', system-ui, -apple-system, sans-serif`; base size 13px.

Layout rules carried over from Jot:

- The window is frameless with **no title bar and no window buttons**. A header row does that job.
- Panes sit on one `--bg` surface with 16px padding and a 14px gap between them. No column backgrounds, no dividers.
- Rows are 8px 10px padding at 8px radius; hover fills `--surface`, selected adds a `--border` border.
- Row actions (rename, delete, the scope chip) stay hidden until the row is hovered. A category that already carries a W or P scope keeps its chip at partial opacity so the classification stays readable.
- Colour marks active state only. An active toolbar button gets a grey wash (`rgba(127,127,127,0.18)`) and full-strength text, never a coloured fill.
- The drag insertion marker is a 3px `--accent` bar, inset from both edges, fully rounded, with a soft glow. Jot learned this the hard way: a thin full-width line read as a section divider and went unnoticed.

## Data model

Three levels: **category → sub-category → note**, nesting one level only.

```
topic  { id, name, color, scope: '' | 'W' | 'P', open, subs[], notes[] }
sub    { id, name }
note   { id, title, html, edited, subId: string | null, pinned }
```

Notes are a **flat list on the category** carrying a `subId`, not a list nested inside
each sub-category. A note with `subId: null` sits directly in the category.
This mirrors how Jot models subtasks (a `parentId` on a flat todo list) and keeps moving
a note between sub-categories a single field write rather than a splice across two arrays.

A category's count means everything under it, its loose notes and its sub-categories' both.

## Artboard 1: main window

1240 x 780, frameless.

### Header

Wordmark "Nib" at 20px with 0.5px letter-spacing in a fixed 210px slot, a dim version
number beside it, and a 180px search field on the right (transparent, 1px `--border`,
8px radius, 12px text).

### Sidebar, 210px

- **Smart rows** at the top: All notes, Recent, and Sticky notes. Each carries a marker and a count; the sticky row's marker is an `--amber` rounded square rather than a circle.
- **Scope filter**: All / Work / Private as a segmented control in a `--surface` well with a `--border` outline.
- **Category rows**: a disclosure caret that rotates 90 degrees when open, a 10px colour dot, the name, a W/P scope chip that cycles on click, rename and delete affordances, and the count.
- **Sub-category rows**, indented 30px under their category: 12px text, 4px 6px padding, 6px radius, `--text-dim` until selected, hovering to `--border` because `--surface-hover` is too subtle at that size. Each shows a delete affordance and a count.
- A dashed **"+ Sub-category…"** input under the last sub-category, and a dashed **"+ Category…"** input at the bottom of the list. Both commit on Enter.
- Double-clicking a category or sub-category renames it inline; Enter commits, Escape cancels.

Selecting a **category** lists every note under it. Selecting a **sub-category** lists only that sub-category's.

### Note list, 280px

A header line with the active list's dot, name and count, an "Add a note…" field, then the cards.

Each card carries: the title, a pin marker (dim when unpinned, `--amber` when pinned, toggling on click), a delete affordance, a two-line preview built from the note's block elements joined with `·`, and a metadata row with the sub-category crumb, the relative edit time (`today`, `yesterday`, `3 days ago`, `2w ago`), an `image` tag in `--accent` when the note holds an image, and a `drawing` tag in `--violet` when it holds a canvas.

The crumb only appears when the list spans more than one place: listing a whole category, or listing sticky notes, where the crumb is the full `Category › Sub-category` trail.

### Editor panel

A `--surface` panel with a 1px `--border`, 12px radius and 18px padding, matching Jot's detail panel.

Toolbar: `H1` `H2` `H3` `Body` | `B` `I` `U` `S` `code` | `Bullets` `1. List` `Quote` `Divider` | `Image` `Canvas`, with a "Pin as sticky" / "Sticky" toggle on the right end.

Document: a borderless 26px title input, a metadata row (category trail, word count, `edited …`, a private tag when the category is scoped Private), then the editable body at 14px / 1.7 line-height in a centred column whose width is adjustable.

### Drag and drop

- Categories reorder against each other.
- Notes reorder within a list.
- Dropping a note on a **sub-category row** moves it there; dropping it on a **category row** moves it to that category's loose notes.

### Images

Paste, drop, or the `Image` button. Clicking an image selects it and raises a floating
toolbar with **Smaller**, **Larger** and **Remove**. Escape or clicking away deselects;
Backspace or Delete while selected removes it.

### Saving

Typing marks the note unsaved and schedules a save 600ms later; the header shows `Saved` or `Saving…`. `Ctrl+Enter` saves immediately. `Ctrl+Shift+8` inserts a bullet list.

## Artboard 2: sticky windows

280 x 320 each, always on top, shown three abreast so the tint palette is visible.

A `--surface` panel, 12px radius, 1px `--border`, with a heavy drop shadow.

- A drag strip across the top, tinted with the note's colour, holding a row of tint swatches (the selected one ringed), an "always on top" toggle, and a close ×.
- The note title at 14px semibold.
- The note body, editable in place, at 12.5px / 1.6 line-height. No toolbar - the formatting rules are the same, the chrome is not.
- A footer line at 10px `--text-dim` showing the note's category trail, so you can tell where a floating note came from.

Sticky windows are bound to the pinned notes themselves: pinning a note in the main window is what produces one.

## Artboard 3: canvas block, open for drawing

A canvas is a **block inside a note**, the same way a pasted image is - not a separate kind of note.

Inserted from the `Canvas` toolbar button, it renders in the document as a 170px bordered
box with a faint ruled-paper background and a header reading "Drawing · click to open"
with a `--violet` marker. It is marked `contenteditable="false"` and carries a
`data-canvas` attribute, which is also what the note card's `drawing` tag keys off.

Opened, it fills the editor pane:

- **Tool strip**: Pen, Highlighter, Eraser, Select; a stroke-width slider (1-18) with its value; a row of ink swatches (`--text`, `--accent`, `--amber`, `--green`, `--violet`, `--danger`); the current pointer type; a live `pressure 0.00` readout in a monospace chip; and a small vertical meter that fills with pressure. Undo, Redo and Done sit on the right.
- **Surface**: `--bg` with a faint ruled background and a 1px `--border`, backed by a canvas at 2x device pixels.

Drawing behaviour, all of it exercised in the mock rather than described:

- Pointer events throughout, with `touch-action: none` and pointer capture.
- Stroke width is driven by `event.pressure`: `width * multiplier * (0.35 + 1.3 * pressure)`, so a pressure-sensitive stylus tapers and a mouse (which reports a constant 0.5) draws evenly. Minimum 0.6px.
- Per-tool multipliers: highlighter 3x at 0.28 alpha, eraser 2.2x drawn as `destination-out`, pen 1x.
- **Palm rejection**: once a pen has been seen, touch input is ignored until 400ms after the pen lifts.
- Undo and redo work on whole strokes, and redo is cleared when a new stroke starts.

## Adjustable in the mock

Worth keeping as real settings:

- **Accent colour** - `--accent` (default), `--green`, `--amber`, `--violet`.
- **Measure** - the editor column width, 600-1000px in 20px steps, default 720.
- **Serif body** - switches the document font to `Iowan Old Style, Georgia, serif`.

## What the mock still does not cover

- **Persistence.** The mock keeps everything in memory; nothing is written to disk. This is the first thing the implementation has to add, and it decides the shape of everything above it.
- **Multiple windows.** The sticky artboard draws the windows; it does not model creating, positioning or restoring real always-on-top windows.
- **Canvas storage.** The drawing exists as a stroke list in memory. How a drawing is stored inside a note - stroke data, a rendered image, or both - is undecided.
