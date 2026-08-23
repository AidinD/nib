import type { AlertMeta, NoteMeta } from '@shared/types'
import { extractAlerts, sanitizeHtml } from './notes'

/**
 * Tick an action point off, or back on, from outside the editor.
 *
 * `done` keeps the block marked and takes it out of the strip and the count -
 * the mark is the point: a line that needed doing and has been dealt with should
 * still read as one, not silently turn back into ordinary text.
 *
 * The flag lives on a block in the note body, so this reads the note file, sets
 * the attribute and writes it back. The index is only a shadow of the body;
 * changing the shadow alone would put the two out of step and the flag would come
 * back on the note's next save.
 */
export async function setAlertDone(
  note: NoteMeta,
  alertId: string,
  done: boolean
): Promise<{ alerts: AlertMeta[]; edited: number } | null> {
  const doc = await window.nib.readNote(note.id)
  if (doc === null) {
    return null
  }

  const holder = document.createElement('div')
  holder.innerHTML = sanitizeHtml(doc.html)
  const block = holder.querySelector(`[data-alert-id="${alertId}"]`) as HTMLElement | null
  if (block === null) {
    // Already gone - the block was deleted, or cleared in the editor meanwhile.
    return { alerts: extractAlerts(doc.html), edited: doc.edited }
  }

  block.dataset.alert = done ? 'done' : '1'
  const html = sanitizeHtml(holder.innerHTML)
  const edited = await window.nib.writeNote({ ...doc, html })
  return { alerts: extractAlerts(html), edited }
}
