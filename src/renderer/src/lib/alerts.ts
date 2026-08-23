import type { AlertMeta, NoteMeta } from '@shared/types'
import { extractAlerts, sanitizeHtml } from './notes'

/**
 * Clear one action point, from outside the editor.
 *
 * The flag lives on a block in the note body, so clearing it means editing that
 * body - which is why this reads the note file, takes the attributes off the
 * block and writes it back, rather than touching the index alone. The index is a
 * shadow of the body; changing only the shadow would put the two out of step and
 * the flag would come back on the note's next save.
 *
 * Returns the note's remaining alerts and its new `edited` stamp, for the caller
 * to patch into the index.
 */
export async function clearAlert(
  note: NoteMeta,
  alertId: string
): Promise<{ alerts: AlertMeta[]; edited: number } | null> {
  const doc = await window.nib.readNote(note.id)
  if (doc === null) {
    return null
  }

  const holder = document.createElement('div')
  holder.innerHTML = sanitizeHtml(doc.html)
  const block = holder.querySelector(`[data-alert-id="${alertId}"]`)
  if (block === null) {
    // Already gone - the block was deleted, or cleared in the editor meanwhile.
    return { alerts: extractAlerts(doc.html), edited: doc.edited }
  }

  const element = block as HTMLElement
  delete element.dataset.alert
  delete element.dataset.alertId

  const html = sanitizeHtml(holder.innerHTML)
  const edited = await window.nib.writeNote({ ...doc, html })
  return { alerts: extractAlerts(html), edited }
}
