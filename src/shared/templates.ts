/**
 * Templates: the shape a note starts with, as data rather than as code.
 *
 * ## Why this exists at all
 *
 * A recurring note has two costs and only one of them is the writing. The other
 * is the setup: the same title format typed by hand every week, and the same
 * questions remembered from memory or copied from the last one. Both are small,
 * both happen at the exact moment you are least willing to spend effort - just
 * after a conversation - and together they are why the note does not get written.
 *
 * ## Why the story became one instead of staying special
 *
 * The story template was hard-coded, and it was the only one. Adding a second
 * hard-coded template would have been two special cases, and a third would have
 * settled the shape by accident. Making them data is fewer moving parts than the
 * version that has two, not more.
 *
 * What did NOT collapse into this: the note KIND. A story has its own view and
 * its own half-captured check; a template only decides what a note starts with.
 * So a template may set a kind, and exactly one does. Collapsing those two ideas
 * would have made every template a note type, which is a much bigger claim than
 * "here is what to write".
 *
 * ## The one substitution
 *
 * `{date}` in a title, and nothing else. A recurring note is almost always dated
 * and almost never anything more elaborate, and every token added here is one a
 * reader has to know about before they can predict what the button will do.
 */

import type { Template } from './types'

export type { Template }

/** Caps, so a corrupt or hostile index cannot make the renderer draw nonsense. */
export const MAX_TEMPLATES = 32
export const MAX_TEMPLATE_NAME = 40
export const MAX_TEMPLATE_TITLE = 120
export const MAX_TEMPLATE_BODY = 20_000

/**
 * The prompts a one-to-one starts with.
 *
 * Written by the person who runs them, not derived from a book, and the
 * structure is the interesting part: two of the sections alternate between
 * conversations. A fortnightly rotation asks the slow questions - the six-month
 * one, the pressure-versus-learning one - often enough to catch a drift and
 * rarely enough that they do not become a script the other person learns to
 * answer.
 *
 * Both weeks are written into the note and the one that does not apply is
 * deleted. The alternative was for the app to work out which week it is, which
 * it cannot: the rotation belongs to the pair, not to the calendar, and a
 * conversation that gets moved a week would silently ask the wrong half.
 */
const ONE_TO_ONE_BODY = [
  '<h3>Uppföljning</h3>',
  '<p><em>Hur går det med det vi kom överens om förra gången? Något som behöver ändras, eller kan vi checka av det?</em></p>',
  '<h3>Öppen space</h3>',
  '<p><em>Vad skulle du vilja prata om? Något som jag kan hjälpa dig med?</em></p>',
  '<h3>Energi och friktion</h3>',
  '<p><em>Vecka 1: Vad har gett energi senaste veckorna, och vad har dragit energi eller känts trögt?</em></p>',
  '<p><em>Vecka 2: Vad är din största tekniska utmaning just nu? Är det något i projektet som hindrar dig från att göra ditt bästa jobb?</em></p>',
  '<h3>Relationer och feedback</h3>',
  '<p><em>Hur funkar samarbetet i teamet just nu? Vad ska jag börja, sluta eller fortsätta göra som chef?</em></p>',
  '<h3>Karriär och utveckling</h3>',
  '<p><em>Vecka 1: Om du tittar sex månader framåt, vad vill du kunna säga att du utvecklat?</em></p>',
  '<p><em>Vecka 2: Känner du att du har rätt balans mellan press och att faktiskt hinna lära dig nya saker?</em></p>',
  '<h3>Något annat</h3>',
  '<p><em>Är det något annat du vill ta upp?</em></p>'
].join('')

/**
 * The story's four questions, in STAR order.
 *
 * Moved here from its own module when templates became data. The wording is
 * load-bearing and the reasoning behind it lives in `story.ts`, which still owns
 * the half-captured check that reads these headings back.
 */
export const STORY_BODY = [
  '<h3>Situation</h3>',
  '<p><em>Where was this, when, and what was the state of things? Enough for somebody who was not there.</em></p>',
  '<h3>What was actually at stake</h3>',
  '<p><em>Not the task as assigned - what would have gone wrong. This is what makes the story worth telling.</em></p>',
  '<h3>What you did, as opposed to the team</h3>',
  '<p><em>The part only you did. "We shipped it" is not an answer to anything; it is the sentence this field exists to prevent.</em></p>',
  '<h3>What changed, and how you know</h3>',
  '<p><em>A number if there is one. If there is not, say what would be different now if you had not.</em></p>'
].join('')

/**
 * The templates a notebook starts with.
 *
 * Fixed ids for the same reason the seeded tags have them: a template that got a
 * fresh id on every machine would be two templates after one sync.
 *
 * Seeded, not required. Rename them, rewrite them, delete them. Nothing breaks
 * if the list is empty - the button simply stops offering anything.
 */
export const DEFAULT_TEMPLATES: Template[] = [
  {
    id: 'tpl-one-to-one',
    name: '1-1',
    title: '{date} 1-1',
    description: 'The questions you actually want to ask, already in the note.',
    body: ONE_TO_ONE_BODY,
    // The seeded 1-1 tag, by its fixed id. Without it the note is written and
    // the conversation still reads as never having happened anywhere that counts
    // tagged notes.
    tags: ['tag-one-to-one']
  },
  {
    id: 'tpl-story',
    name: 'Story',
    title: '',
    description: 'A career story, in four questions. Fill it in while it is fresh.',
    body: STORY_BODY,
    kind: 'story'
  }
]

/**
 * Today, as the date part of a title.
 *
 * ISO, because it sorts. A note list ordered by name is the one place a date
 * format earns or loses its keep, and every other format loses.
 */
export function today(now: number = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The title a new note gets from a template.
 *
 * Falls back to whatever was typed, then to the template's own name, so the
 * button always produces something findable. An untitled note is a note you
 * cannot come back to.
 */
export function titleFrom(template: Template, typed: string, now: number = Date.now()): string {
  // Whatever was typed wins outright. The first version kept the date and
  // appended the typed words, which produced "2026-08-27 Halvar" for a note
  // already filed in Halvar's folder - the title repeating what the location
  // already said, while saying nothing about what the note IS.
  const typedTitle = typed.trim()
  if (typedTitle.length > 0) {
    return typedTitle
  }
  const rendered = template.title.trim().replace(/\{date\}/g, today(now)).trim()
  return rendered.length > 0 ? rendered : template.name
}

/** One template, read defensively. */
function normalizeTemplate(raw: any): Template {
  const kind = raw?.kind === 'story' ? 'story' : undefined
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? '').slice(0, MAX_TEMPLATE_NAME),
    title: String(raw?.title ?? '').slice(0, MAX_TEMPLATE_TITLE),
    body: String(raw?.body ?? '').slice(0, MAX_TEMPLATE_BODY),
    description: String(raw?.description ?? '').slice(0, MAX_TEMPLATE_NAME * 5),
    tags: Array.isArray(raw?.tags)
      ? raw.tags.map((t: unknown) => String(t)).filter((t: string) => t.length > 0)
      : [],
    ...(kind === undefined ? {} : { kind })
  }
}

/**
 * The catalog, from anything.
 *
 * A missing list means a notebook written before templates existed, which gets
 * the defaults - the same upgrade path the tags took. An explicitly empty list
 * is a choice and is left alone: somebody who deleted every template should not
 * find them all back the next time the app starts.
 */
export function normalizeTemplates(raw: unknown): Template[] {
  if (raw === undefined || raw === null) {
    return DEFAULT_TEMPLATES.map((t) => ({ ...t }))
  }
  if (!Array.isArray(raw)) {
    return []
  }
  const seen = new Set<string>()
  const out: Template[] = []
  for (const value of raw) {
    const template = normalizeTemplate(value)
    if (template.id.length === 0 || template.name.length === 0 || seen.has(template.id)) {
      continue
    }
    seen.add(template.id)
    out.push(template)
    if (out.length >= MAX_TEMPLATES) {
      break
    }
  }
  return out
}
