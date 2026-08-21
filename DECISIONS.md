# Nib - decisions

Newest first.
Each entry records the decision, what else was considered, and why the choice was made.

## 2026-08-21 - An image's size is stored in a data attribute, not a style or a width

The width of an image in a note is stored as `data-w` and applied as an inline
style every time a note is loaded.

Two more obvious approaches were tried and both lost the size silently:

- **An inline `style`.** `style` is not on the sanitiser's allowed-attribute list, on purpose - letting arbitrary CSS in from a paste is exactly what a sanitiser is for. The resize looked right and was gone after a reload.
- **A plain `width` attribute.** Allowed on paper, and still not present in the saved HTML. Data attributes, on the other hand, survive this configuration.

So the size is kept as data and turned back into a width in one place,
`applyImageWidths`, which every load path calls. Found by resizing a real pasted
image, saving, and reading the note file back: the DOM said 375px and the file
said nothing.

## 2026-08-21 - Drag and drop is the native API, not Jot's @dnd-kit

Jot reorders its lists with @dnd-kit. Nib uses the browser's own HTML5 drag and
drop instead.

What Nib has to drag decides it: a note card is dropped on three different kinds
of target across two panes - between cards, on a category row, on a sub-category
row - and the editor already handles native file drops for pasted images. One API
for all of it beats a sortable-list library plus the native path side by side.

Two things the native API forces and are worth knowing:

- `dataTransfer` cannot be read during `dragover` (the spec calls it protected mode), so the dragged item is also kept in a module-level variable. A target has only `types` to go on otherwise.
- Reordering is expressed as "place this before that", not "move to index N". The index form has to be corrected for the fact that pulling the item out shifts everything after it, and that correction is exactly the off-by-one everyone writes twice.

Reordering is offered only inside a category, where the order is actually stored.
The smart lists have their own sorts - Recent by edit time, Sticky by pin - so a
card dropped there would snap straight back, and no marker is shown.

## 2026-08-21 - A window picks up edits made to the same note elsewhere

A note open in both the main window and its sticky window is one file, and either
window reloads its body when the other one saves - but only while it is clean and
unfocused.

Both halves of that condition matter. Replacing the text under a caret that is
mid-sentence is worse than showing the change a moment late, and a body with
unsaved edits must never lose them to a reload. The result is that the two views
converge as soon as you look away from one of them, instead of drifting apart and
then overwriting each other.

This is also what makes another machine's sync visible without a restart: the
index watch fires, the note's `edited` stamp moves, and any window showing it that
is not being typed into reloads.


## 2026-08-21 - Pasted images live in a content-addressed assets folder

Images pasted into a note are written to `assets/<sha256>.<ext>` in the data
directory and referenced from the note body through a custom `nib-asset://`
scheme, rather than embedded in the note file as a base64 data URL.

This closes the question left open by the file-per-note decision below.

- A note file stays small and readable. A screenshot embedded as base64 is a megabyte of unreadable text in the middle of the document, and it is rewritten on every keystroke's save.
- The filename is the content hash, so the same image pasted into two notes - or re-pasted after an undo - is stored once.
- The scheme is registered as privileged and resolved in the main process, which also refuses any path that climbs out of the assets folder. The renderer never gets filesystem access to make this work.

The cost is that an image is no longer *inside* the note it belongs to: deleting a
note cannot delete its images, because another note may reference the same bytes.
A sweep for unreferenced assets is the answer and is not built yet. That is
recorded in PLAN.md as an open question rather than solved speculatively.

Considered and rejected: base64 in the note file. It keeps a note perfectly
self-contained and portable, which is genuinely attractive for a local-first
tool, but it loses on every write and makes the note file unreadable by hand -
and readability is exactly why this app is not a database.

## 2026-08-21 - Rich text uses the browser's own editing commands

The editor is a `contenteditable` region formatted through `document.execCommand`.

`execCommand` is deprecated and its replacement is not shipping, so every
contenteditable editor either uses it or ships a whole editing engine. For a
local notes app run in one known Chromium version, the trade is worth it: the
whole formatting layer is a few lines per command instead of a dependency with a
document model of its own.

The fallback, when it does break, is a real editor library - not a hand-rolled
selection model. That is the point of writing this down.

Two details that came out of building it:

- Pasted HTML is sanitised on the way in **and** on the way out. A paste from a browser brings scripts, inline styles and remote images; a note file is also something an external tool or a synced folder can write, so it is never trusted just because we wrote it.
- The bullet-list shortcut is matched on `event.code === 'Digit8'`, not on the character. On a Swedish layout Shift+8 produces `(`, not `*`, so keying off the character would have made `Ctrl+Shift+8` silently disappear on the author's own keyboard.

## 2026-08-21 - One renderer bundle, two window types, routed by the hash

The main window and the sticky windows are the same built renderer. Which one a
window is comes from its hash: `#sticky/<noteId>` is a sticky, anything else is
the main window.

Jot ships a second HTML entry point for its capture window. That works, but the
sticky window shares almost everything with the main one - the tokens, the index
store, the sanitiser, the note read/write path - so a second entry point would
duplicate a bundle to change two components.

The sticky window edits the same note file the main window edits, rather than
holding a copy. There is no reconciliation step because there is nothing to
reconcile: the note is the single source of truth, and both windows reload when
the index changes.

## 2026-08-21 - The frameless window keeps three small window controls

The design spec says no title bar and no window buttons, with the header row
doing that job. The header is the drag handle as specified, but it also carries
minimise, maximise and close at its right end.

A frameless window with no close affordance has to be closed from the taskbar or
by a keyboard shortcut, which is worse than the three 26px buttons it takes to
avoid. This is a deliberate, documented departure from the spec, not a detail
that slipped through: if it turns out to be wrong, the fix is to delete the
controls and restore the frame decision, not to re-derive why they are there.


## 2026-08-19 - The data directory follows Jot's pattern

Nib stores its notes in Electron's `userData` folder by default (`%APPDATA%/nib` on
Windows), and honours a `NIB_DATA_DIR` environment variable that relocates them.
On the author's machines that variable points at a Dropbox folder, the same way
`JOT_DATA_DIR` does for Jot.

The reasons are Jot's, and they still hold:

- A fresh install works with no setup, so a distributed copy stays portable. The synced location is per-machine configuration, never baked into the app.
- It puts the data somewhere an external tool can reach without Windows' filesystem virtualisation getting in the way. Writes to `%APPDATA%` from a sandboxed process can land in a private overlay the app never sees; a path on a real drive does not have that problem.
- Sync comes free from the folder itself, with no sync layer to build or run.

Copy Jot's one-time migration too: when `NIB_DATA_DIR` points somewhere that has no data
yet, move the existing `userData` contents across once. It runs on every start and is a
no-op afterwards, so it can never clobber newer data.

The file-per-note decision below is what makes the synced folder work well: editing one
note touches one file, so two machines editing different notes do not collide.

## 2026-08-19 - Notes are a flat list carrying a sub-category id

A category holds `subs` (id and name only) and a **flat** `notes` array, where each note
carries `subId`, which is null when the note sits directly in the category.
Notes are not nested inside the sub-category they belong to.

This is how Jot already models subtasks: a flat todo list where a `parentId` does the
nesting. Following it keeps the two apps' storage legible in the same way, and it makes
moving a note between sub-categories one field write instead of a splice across two
arrays. Counting everything under a category is one filter rather than a walk.

Considered and rejected: nesting `notes` inside each sub-category. It reads more
naturally on paper, but every operation that spans a category - counting, searching,
listing all notes, moving between levels - has to walk two shapes instead of one.

## 2026-08-19 - Nib uses Jot's design tokens verbatim

The first mock had its own dark palette and an indigo accent. It was replaced with the
exact tokens from Jot's `styles.css`, along with Jot's layout language: no window chrome,
no column backgrounds or dividers, row actions hidden until hover, and colour reserved
for active state.

The two apps sit side by side on the same desktop and are meant to be recognisably one
family. A second, similar-but-different dark theme would read as a near-miss rather than
a sibling. The cost is that a change to Jot's palette now has two places to land, which
is accepted: the tokens have been stable for the life of Jot.

One detail worth keeping when implementing: Jot's drag insertion marker is a glowing,
inset, rounded 3px bar rather than a hairline. Its CSS records why - a thin full-width
line read as a section divider and nobody noticed it.

## 2026-08-19 - The name is Nib

A nib is the tip of a pen.
It is short, it is unclaimed as a product name, and it sits naturally beside Jot without being derivative of it.

Considered and rejected:

- **Jot Notes.** The mock was drawn under this name, and it borrows Jot's vocabulary throughout. Rejected because the app is a separate product with its own data and its own window, and a shared name would imply a shared install and a shared store.
- **Vellum.** Suggests an archive of long documents. The app is closer to a working surface than an archive.
- **Cairn.** A trail marker. Evocative but needs explaining.
- **Margin.** The clearest meaning of the four, but too common a word to own in search results.

## 2026-08-19 - A separate app, not a tab inside Jot

Nib ships as its own application, installed alongside Jot, with its own data store.

The mock arrived titled "Jot Notes" and reused Jot's list-and-scope vocabulary, which made a Jot tab look like the natural home.
It was rejected: notes and todos have different lifetimes, different editing models and very different storage needs - a todo is a line of text, a note is a document with images embedded in it.
Folding them together would mean one store serving two shapes and one window serving two jobs.

Nothing rules out a later link between the two, such as attaching a note to a todo.
That is a bridge between two apps, not an argument for one app.

## 2026-08-19 - One file per note, not one file for everything

Notes are stored as one file per note, with an index for ordering and metadata, rather than a single JSON document like Jot's `todos.json`.

The deciding factor is images.
Requirement: images are pasted **into** the document rather than attached beside it, which means every note can carry embedded image data.
A single JSON file holding every note plus every image would grow into the tens of megabytes and be rewritten in full on each keystroke's save.

It also behaves better in a synced folder: editing one note touches one file, so two machines editing different notes do not collide over the same document the way they would with one shared file.

Considered and rejected:

- **Single JSON, as in Jot.** Simple and proven for todos, but a todo is a line of text. It does not survive embedded images.
- **A database file, such as SQLite.** Solves size and write amplification, but the notes stop being readable or recoverable without the app - a real cost for a local-first tool whose data lives in a synced folder.

Open, and deliberately not decided yet: whether image data is embedded in each note file or written to a sibling assets folder and referenced.
That is a storage-layer detail and does not change the file-per-note shape.

## 2026-08-19 - The design spec is checked in, the mock is not

The Claude Design mock was distilled into [docs/design-spec.md](docs/design-spec.md) rather than committed as a file.

The mock depends on Claude Design's own runtime to render, so a copy in this repository would not open and would not be editable.
A spec, on the other hand, states the measurements, colours and interactions in a form the implementation can be checked against, and a reviewer can read without any tooling.
