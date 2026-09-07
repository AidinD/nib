import { useEffect, useMemo, useRef, useState } from 'react'
import type { NibIndex } from '@shared/types'

import { htmlToText } from './notes'
import { BODY_SEARCH_MIN } from './selection'
import type { NoteText } from './selection'

/**
 * The text of every note, read on demand and kept for the session.
 *
 * The search needs the bodies, and the bodies are one file each - so this is the
 * one place in the app that reads the whole notebook. It is cheaper than it
 * sounds: 127 notes and 600 kB came back in about 30ms on the author's own
 * notebook, which is a flicker rather than a wait, and it happens once.
 *
 * Read on the first search rather than at startup, deliberately. Opening Nib to
 * write a note should not read 127 files, and someone who never searches never
 * pays for it. The cost lands on the keystroke that needs it.
 *
 * Kept keyed by `edited`, which is how a stale body is noticed: the metadata
 * arrives with every index change, so a note edited here, in its sticky window,
 * or on another machine through the synced folder comes back with a newer stamp
 * and is read again. Without that, a search would go on answering from the text
 * a note had when it was first read - and the note it would miss is the one
 * being worked on right now.
 */
export function useSearchText(index: NibIndex, search: string): Map<string, NoteText> {
  /*
   * A ref rather than state, with a counter beside it to force the render.
   *
   * The map is mutated in place as notes arrive and read on every keystroke, and
   * copying it into new state on each read would rebuild 600 kB of strings for
   * nothing. The counter is what tells React something changed.
   */
  const cache = useRef(new Map<string, { edited: number; body: NoteText }>())
  const [version, setVersion] = useState(0)
  const loading = useRef(false)

  const needle = search.trim()

  useEffect(() => {
    if (needle.length < BODY_SEARCH_MIN || loading.current) {
      return
    }
    const stale = new Map<string, number>()
    for (const category of index.categories) {
      for (const note of category.notes) {
        const held = cache.current.get(note.id)
        if (held === undefined || held.edited !== note.edited) {
          stale.set(note.id, note.edited)
        }
      }
    }
    if (stale.size === 0) {
      return
    }

    let cancelled = false
    loading.current = true
    void window.nib
      .readNotes(Array.from(stale.keys()))
      .then((docs) => {
        if (cancelled) {
          return
        }
        /*
         * Whatever did not come back is recorded as empty, at the stamp that was
         * asked for.
         *
         * A note in the index with no file on disk is skipped by the read, and
         * without this it would stay stale forever - so the effect would ask for
         * it again on the render its own answer caused, and again. That is an
         * infinite loop over a case that is only ever a stale index.
         */
        for (const [id, edited] of stale) {
          cache.current.set(id, { edited, body: { text: '', lower: '' } })
        }
        for (const doc of docs) {
          /*
           * The same extraction the previews and the word count use, on purpose.
           *
           * A second way of turning a note into text is a second answer to what a
           * note says, and the two would disagree: a search that finds a word the
           * preview of the same note does not contain, or the other way round, is
           * a search nobody trusts. It is also why this runs in the renderer,
           * where there is a DOM to parse the HTML with.
           */
          const text = htmlToText(doc.html)
          const title = doc.title.trim()
          const whole = title.length > 0 ? `${title}\n${text}` : text
          cache.current.set(doc.id, {
            edited: doc.edited,
            body: { text: whole, lower: whole.toLowerCase() }
          })
        }
        setVersion((count) => count + 1)
      })
      .finally(() => {
        loading.current = false
      })

    return () => {
      cancelled = true
    }
    // `index` is in the dependencies for the `edited` stamps, which is the whole
    // invalidation mechanism. It changes on every save, and the walk above is
    // over metadata already in memory.
  }, [needle.length >= BODY_SEARCH_MIN, index, version])

  return useMemo(() => {
    const bodies = new Map<string, NoteText>()
    for (const [id, held] of cache.current) {
      bodies.set(id, held.body)
    }
    return bodies
    // Rebuilt when something was read, and never on a keystroke: the map holds
    // references to the same strings, so this is cheap - but pointless to redo
    // when nothing has arrived.
  }, [version])
}
