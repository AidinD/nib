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
  moveCategory: (categoryId: string, toIndex: number) => void
  addSub: (categoryId: string, name: string) => void
  renameSub: (categoryId: string, subId: string, name: string) => void
  deleteSub: (categoryId: string, subId: string) => void
  addNote: (categoryId: string, subId: string | null, title: string) => string
  deleteNote: (noteId: string) => void
  togglePin: (noteId: string) => void
  moveNote: (noteId: string, categoryId: string, subId: string | null) => void
  reorderNote: (categoryId: string, noteId: string, toIndex: number) => void
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

function move<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) {
    return items
  }
  const next = items.slice()
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item)
  return next
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

    moveCategory: (categoryId, toIndex) =>
      mutate((index) => ({
        ...index,
        categories: move(
          index.categories,
          index.categories.findIndex((c) => c.id === categoryId),
          toIndex
        )
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

    reorderNote: (categoryId, noteId, toIndex) =>
      mutate((index) =>
        mapCategory(index, categoryId, (c) => ({
          ...c,
          notes: move(
            c.notes,
            c.notes.findIndex((note) => note.id === noteId),
            toIndex
          )
        }))
      ),

    patchNoteMeta: (noteId, patch) =>
      mutate((index) => mapNote(index, noteId, (note) => ({ ...note, ...patch })))
  }
}
