# Nib - decisions

Newest first.
Each entry records the decision, what else was considered, and why the choice was made.

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
