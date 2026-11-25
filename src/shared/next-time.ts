/**
 * "Till nästa gång": what to have in front of you before the next conversation
 * with the same person.
 *
 * ## Why it is a section and not a field
 *
 * A 1-1 ends with things to pick up next time - a promise either side made, a
 * question left open, something to check on - and the moment they matter is a
 * week or two later, just before the next one. Before this they were somewhere
 * in last time's note, so finding them meant opening it and reading it, which
 * is the step that does not happen in the five minutes before a meeting.
 *
 * It is a heading in the note, written like any other section, because that is
 * where it gets written: during the conversation, in the note. A field beside
 * the note would be a second place to type into. The summary fills a section
 * under the same heading from the transcript, so both are found the same way.
 *
 * ## Where it shows
 *
 * Read back from the newest note in the folder that has one, and shown twice:
 * at the top of that person's folder, and carried into the next note made from
 * the template, as open checklist items under the template's first section -
 * which in the 1-1 is "Uppföljning", the question about exactly this.
 */

import type { NoteMeta } from './types'

/** The heading, as the 1-1 template writes it and the summary repeats it. */
export const NEXT_TIME = 'Till nästa gång'

/** The template's prompt under it - read back as a prompt, never as something written. */
export const NEXT_TIME_PROMPT = 'Inför nästa gång: vad lovade vi varandra, vad lämnades öppet, vad vill jag följa upp?'

/** Whether a heading's text names the section. Also the English, for a template rewritten in it. */
export function isNextTimeHeading(text: string): boolean {
  const plain = text.replace(/\s+/g, ' ').trim().replace(/[:.]$/, '').toLowerCase()
  return plain === 'till nästa gång' || plain === 'nästa gång' || plain === 'next time'
}

/**
 * When a note's conversation happened: the date its title starts with, or when
 * the note was made. A 1-1 written up a day late is still the 1-1 of its date.
 */
export function noteDate(note: Pick<NoteMeta, 'title' | 'created'>): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(note.title.trim())
  if (match !== null) {
    const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
    if (Number.isFinite(at)) {
      return at
    }
  }
  return note.created
}

/**
 * The notes worth reading for the latest section, newest first.
 *
 * One folder, live notes only, and - when tags are given - only notes carrying
 * one of them, so a 1-1 is followed by the previous 1-1 rather than by whatever
 * else was filed with that person. Capped: the section is in one of the last few
 * notes or it is not current.
 */
export function nextTimeCandidates(
  notes: readonly NoteMeta[],
  folder: { categoryId: string; subId: string | null },
  tags: readonly string[] = [],
  limit = 6
): NoteMeta[] {
  return notes
    .filter(
      (note) =>
        note.categoryId === folder.categoryId &&
        (note.subId ?? null) === (folder.subId ?? null) &&
        !note.archived &&
        (tags.length === 0 || note.tags.some((tag) => tags.includes(tag)))
    )
    .sort((a, b) => noteDate(b) - noteDate(a) || b.created - a.created)
    .slice(0, limit)
}

/** Whether a template body has the section, and so wants last time's carried in. */
export function hasNextTime(body: string): boolean {
  return Array.from(body.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g)).some((match) =>
    isNextTimeHeading(match[1].replace(/<[^>]*>/g, ''))
  )
}

const escape = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/**
 * A new note's body with last time's list carried into it.
 *
 * Open checklist items, so they can be ticked off as they come up - the
 * template's first question is whether the things agreed last time got done.
 * Placed under the first heading and its prompt; at the top when the body has
 * no heading.
 */
export function withCarriedOver(body: string, lines: readonly string[], from: string): string {
  if (lines.length === 0) {
    return body
  }
  const block =
    `<p><strong>Från förra gången</strong> (${escape(from)}):</p>` +
    `<ul>${lines.map((line) => `<li data-task="open">${escape(line)}</li>`).join('')}</ul>`
  const heading = /<\/h[1-6]>/.exec(body)
  if (heading === null) {
    return block + body
  }
  let at = heading.index + heading[0].length
  // Past the prompt paragraphs that follow it: a prompt is a question to ask,
  // and the list is the answer to have ready.
  const prompt = /^<p><em>[\s\S]*?<\/em><\/p>/
  for (let match = prompt.exec(body.slice(at)); match !== null; match = prompt.exec(body.slice(at))) {
    at += match[0].length
  }
  return body.slice(0, at) + block + body.slice(at)
}
