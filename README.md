# Nib

A keyboard-friendly desktop note-taking app, built as a sibling to [Jot](https://github.com/AidinD/jot).

Jot captures todos.
Nib captures notes: longer-form, formatted, with images pasted straight into the document.

Status: **project prepared, not implemented**.
See [PLAN.md](PLAN.md) for the current plan and [DECISIONS.md](DECISIONS.md) for why things are the way they are.

## What it is meant to be

- Three panes, like the mock: lists on the left, notes in the middle, editor on the right.
- Real rich-text formatting (headings, bold/italic/underline/strikethrough, code, lists, quotes, dividers).
- Images pasted or dropped **inline in the document**, not attached alongside it.
- Sub-categories, so a note can live under `Manager meeting > February`.
- Sticky notes.
- Local-first storage in a synced folder, no server.

## Repository layout

```
docs/design-spec.md   The visual and interaction spec, distilled from the Claude Design mock
PLAN.md               Current status, scope, and what happens next
DECISIONS.md          Decisions made and the reasoning behind them
```

## License

MIT. See [LICENSE](LICENSE).
