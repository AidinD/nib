import { useCallback, useEffect, useRef, useState } from 'react'
import type { Category, NibIndex, NoteMeta, Scope, SubCategory } from '@shared/types'
import { NOTE_COLORS } from '@shared/types'
import { newId } from './notes'

const EMPTY: NibIndex = { version: 1, categories: [] }

/**
 * The index, in memory, with every mutation writing straight through to disk.
 *
 * There is no separate "dirty" state for the index: it is small (no note bodies
 * live in it), so a rename or a reorder can just persist immediately. Note
 * bodies are the opposite case and are debounced by the editor instead.
 */
export function useNib(): {
  index: NibIndex
  loaded: boolean
  ops: NibOps
} {
  const [index, setIndex] = useState<NibIndex>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  // The last state we wrote, so a change event caused by our own write does not
  // clobber newer local edits that have not been persisted yet.
  const ownWrite = useRef<string>('')

  const reload = useCallback(async () => {
    const next = await window.nib.loadIndex()
    const serialised = JSON.stringify(next)
    if (serialised === ownWrite.current) {
      return
    }
    ownWrite.current = serialised
    setIndex(next)
  }, [])

  useEffect(() => {
    void reload().finally(() => setLoaded(true))
    return window.nib.onIndexChanged(() => {
      void reload()
    })
  }, [reload])

  /** Apply a pure change to the index, then persist it. */
  const mutate = useCallback((change: (current: NibIndex) => NibIndex) => {
    setIndex((current) => {
      const next = change(current)
      ownWrite.current = JSON.stringify(next)
      void window.nib.saveIndex(next).catch((error) => {
        console.error('Failed to save the Nib index', error)
      })
      return next
    })
  }, [])

  const ops = useNibOps(mutate)
  return { index, loaded, ops }
}

export interface NibOps {
  addCategory: (name: string) => void
  renameCategory: (categoryId: string, name: string) => void
  deleteCategory: (categoryId: string) => void
  setCategoryOpen: (categoryId: string, open: boolean) => void
  cycleCategoryScope: (categoryId: string) => void
  /** Reorder: place the category just before `beforeCategoryId`, or last when null. */
  moveCategoryBefore: (categoryId: string, beforeCategoryId: string | null) => void
  addSub: (categoryId: string, name: string) => void
  renameSub: (categoryId: string, subId: string, name: string) => void
  deleteSub: (categoryId: string, subId: string) => void
  addNote: (categoryId: string, subId: string | null, title: string) => string
  deleteNote: (noteId: string) => void
  togglePin: (noteId: string) => void
  moveNote: (noteId: string, categoryId: string, subId: string | null) => void
  /** Reorder within a category: place the note just before `beforeNoteId`, or last when null. */
  moveNoteBefore: (categoryId: string, noteId: string, beforeNoteId: string | null) => void
  patchNoteMeta: (noteId: string, patch: Partial<NoteMeta>) => void
}

const SCOPE_CYCLE: Scope[] = ['', 'W', 'P']

function mapCategory(
  index: NibIndex,
  categoryId: string,
  change: (category: Category) => Category
): NibIndex {
  return {
    ...index,
    categories: index.categories.map((category) =>
      category.id === categoryId ? change(category) : category
    )
  }
}

/** Applies a change to whichever category holds the note. */
function mapNote(
  index: NibIndex,
  noteId: string,
  change: (note: NoteMeta, category: Category) => NoteMeta
): NibIndex {
  return {
    ...index,
    categories: index.categories.map((category) =>
      category.notes.some((note) => note.id === noteId)
        ? {
            ...category,
            notes: category.notes.map((note) =>
              note.id === noteId ? change(note, category) : note
            )
          }
        : category
    )
  }
}

/**
 * Move the item with `id` so it sits immediately before `beforeId`, or last when
 * `beforeId` is null.
 *
 * Expressed as "before this one" rather than "at index N" on purpose: the drop
 * target knows which row the pointer is over, and an index would have to be
 * corrected for the fact that pulling the item out shifts everything after it.
 * Doing that arithmetic here, once, is how the off-by-one stays fixed.
 */
function moveBefore<T extends { id: string }>(items: T[], id: string, beforeId: string | null): T[] {
  const item = items.find((candidate) => candidate.id === id)
  if (item === undefined || id === beforeId) {
    return items
  }
  const without = items.filter((candidate) => candidate.id !== id)
  const at = beforeId === null ? -1 : without.findIndex((candidate) => candidate.id === beforeId)
  const target = at === -1 ? without.length : at
  return [...without.slice(0, target), item, ...without.slice(target)]
}

function useNibOps(mutate: (change: (current: NibIndex) => NibIndex) => void): NibOps {
  return {
    addCategory: (name) =>
      mutate((index) => ({
        ...index,
        categories: [
          ...index.categories,
          {
            id: newId('cat'),
            name: name.trim(),
            color: NOTE_COLORS[index.categories.length % NOTE_COLORS.length],
            scope: '',
            open: true,
            subs: [],
            notes: []
          }
        ]
      })),

    renameCategory: (categoryId, name) =>
      mutate((index) => mapCategory(index, categoryId, (c) => ({ ...c, name: name.trim() }))),

    // The note files are removed by the caller in App, which knows the ids; the
    // index only loses the category.
    deleteCategory: (categoryId) =>
      mutate((index) => ({
        ...index,
        categories: index.categories.filter((category) => category.id !== categoryId)
      })),

    setCategoryOpen: (categoryId, open) =>
      mutate((index) => mapCategory(index, categoryId, (c) => ({ ...c, open }))),

    cycleCategoryScope: (categoryId) =>
      mutate((index) =>
        mapCategory(index, categoryId, (c) => ({
          ...c,
          scope: SCOPE_CYCLE[(SCOPE_CYCLE.indexOf(c.scope) + 1) % SCOPE_CYCLE.length]
        }))
      ),

    moveCategoryBefore: (categoryId, beforeCategoryId) =>
      mutate((index) => ({
        ...index,
        categories: moveBefore(index.categories, categoryId, beforeCategoryId)
      })),

    addSub: (categoryId, name) =>
      mutate((index) =>
        mapCategory(index, categoryId, (c) => ({
          ...c,
          subs: [...c.subs, { id: newId('sub'), name: name.trim() } satisfies SubCategory]
        }))
      ),

    renameSub: (categoryId, subId, name) =>
      mutate((index) =>
        mapCategory(index, categoryId, (c) => ({
          ...c,
          subs: c.subs.map((sub) => (sub.id === subId ? { ...sub, name: name.trim() } : sub))
        }))
      ),

    // Deleting a sub-category keeps its notes: they fall back to the category's
    // loose notes rather than disappearing with the folder they sat in.
    deleteSub: (categoryId, subId) =>
      mutate((index) =>
        mapCategory(index, categoryId, (c) => ({
          ...c,
          subs: c.subs.filter((sub) => sub.id !== subId),
          notes: c.notes.map((note) => (note.subId === subId ? { ...note, subId: null } : note))
        }))
      ),

    addNote: (categoryId, subId, title) => {
      const id = newId('note')
      const now = Date.now()
      mutate((index) =>
        mapCategory(index, categoryId, (c) => ({
          ...c,
          notes: [
            {
              id,
              categoryId,
              subId,
              title: title.trim(),
              preview: '',
              created: now,
              edited: now,
              pinned: false,
              tint: '',
              alerts: [],
              hasImage: false,
              hasDrawing: false
            },
            ...c.notes
          ]
        }))
      )
      return id
    },

    deleteNote: (noteId) =>
      mutate((index) => ({
        ...index,
        categories: index.categories.map((category) => ({
          ...category,
          notes: category.notes.filter((note) => note.id !== noteId)
        }))
      })),

    togglePin: (noteId) => mutate((index) => mapNote(index, noteId, (n) => ({ ...n, pinned: !n.pinned }))),

    moveNote: (noteId, categoryId, subId) =>
      mutate((index) => {
        const source = index.categories.find((category) =>
          category.notes.some((note) => note.id === noteId)
        )
        const note = source?.notes.find((n) => n.id === noteId)
        if (source === undefined || note === undefined) {
          return index
        }
        // Same category: one field write, which is the whole point of keeping the
        // notes flat with a subId rather than nested inside each sub-category.
        if (source.id === categoryId) {
          return mapNote(index, noteId, (n) => ({ ...n, subId }))
        }
        return {
          ...index,
          categories: index.categories.map((category) => {
            if (category.id === source.id) {
              return { ...category, notes: category.notes.filter((n) => n.id !== noteId) }
            }
            if (category.id === categoryId) {
              return { ...category, notes: [{ ...note, categoryId, subId }, ...category.notes] }
            }
            return category
          })
        }
      }),

    moveNoteBefore: (categoryId, noteId, beforeNoteId) =>
      mutate((index) =>
        mapCategory(index, categoryId, (c) => ({
          ...c,
          notes: moveBefore(c.notes, noteId, beforeNoteId)
        }))
      ),

    patchNoteMeta: (noteId, patch) =>
      mutate((index) => mapNote(index, noteId, (note) => ({ ...note, ...patch })))
  }
}
