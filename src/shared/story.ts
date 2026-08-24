/**
 * The story template: four questions, in STAR order.
 *
 * ## Why capture and not composition
 *
 * Nobody sits down and writes career stories in advance. Everybody tries to
 * remember them afterwards, in an interview or a week before a promotion case,
 * when the numbers are gone and "what I did" has blurred into "what the team
 * did". That blur is the whole failure: it is the difference between an answer
 * and an anecdote.
 *
 * So this is a shape to fill in while it is fresh, not a document to author. The
 * headings are questions rather than labels for exactly that reason - "Result"
 * invites a summary, "What changed, and how do you know?" invites a number.
 *
 * ## Three places it pays, not one
 *
 * Interviews are the obvious one. The other two are your own review, and writing
 * somebody else's promotion case - where the same discipline applies and where
 * most managers sit in March trying to remember October.
 */

/** One prompt in the template. */
export interface StoryPrompt {
  heading: string
  /** Shown as placeholder prose in the note, and deleted as it is replaced. */
  hint: string
}

/**
 * The four, and the wording is load-bearing.
 *
 * `Action` is split out from `Task` because it is the one people collapse, and
 * collapsing it is what produces "we shipped it" - a sentence that says nothing
 * about you. The hint asks the question that separates them.
 */
export const STORY_PROMPTS: readonly StoryPrompt[] = [
  {
    heading: 'Situation',
    hint: 'Where was this, when, and what was the state of things? Enough for somebody who was not there.'
  },
  {
    heading: 'What was actually at stake',
    hint: 'Not the task as assigned - what would have gone wrong. This is what makes the story worth telling.'
  },
  {
    heading: 'What you did, as opposed to the team',
    hint: 'The part only you did. "We shipped it" is not an answer to anything; it is the sentence this field exists to prevent.'
  },
  {
    heading: 'What changed, and how you know',
    hint: 'A number if there is one. If there is not, say what would be different now if you had not.'
  }
]

/**
 * The body a new story starts with.
 *
 * Plain heading-and-paragraph HTML, because that is what Nib's editor already
 * stores and sanitises - a story is a note with a shape, not a new document
 * type. The hints go in as real paragraphs rather than placeholders so they
 * survive being edited around, and are visibly meant to be deleted.
 */
export function storyTemplate(): string {
  return STORY_PROMPTS.map(
    (p) => `<h3>${p.heading}</h3><p><em>${p.hint}</em></p>`
  ).join('')
}

/**
 * Which prompts still hold nothing but their hint.
 *
 * Used to tell a half-captured story from a finished one. A story with three of
 * four filled is still worth having; one where only the situation is written is
 * a note that will not survive being read in a year, and saying so is more
 * useful than a tick.
 */
export function unanswered(html: string): string[] {
  const missing: string[] = []
  for (const prompt of STORY_PROMPTS) {
    const at = html.indexOf(prompt.heading)
    if (at === -1) {
      missing.push(prompt.heading)
      continue
    }
    // Everything up to the next heading, or the end.
    const rest = html.slice(at + prompt.heading.length)
    const end = rest.search(/<h[1-6][\s>]/i)
    const section = end === -1 ? rest : rest.slice(0, end)
    const text = section
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim()
    // Still the hint, or empty. Compared on a prefix so an edited-but-not-really
    // hint does not count as an answer.
    if (text.length === 0 || text.startsWith(prompt.hint.slice(0, 24))) {
      missing.push(prompt.heading)
    }
  }
  return missing
}
