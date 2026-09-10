/**
 * What kind of conversation was recorded, and which sections that justifies.
 *
 * ## The damage this exists to stop
 *
 * One summary shape was laid over every recording. After a fourteen-minute
 * catch-up about one ticket, "Sedan förra gången" listed four unrelated open
 * matters as things that "were not raised and need raising next time" - none of
 * which had any business in a conversation about that ticket. They belonged in
 * the next real 1-1, and their absence was not a miss. It read as findings, it
 * was noise, and it took in both the author and a session reading the note back
 * two days running.
 *
 * The root is the same for both offending sections. "Sedan förra gången" only
 * means anything for a RECURRING conversation with the same person: it compares
 * against the previous note in the same folder, which for a one-off is a
 * category error dressed as an insight. "Frågor jag inte ställde" is a coaching
 * device for a 1-1; asked of a check-in about one bounded thing it produces
 * filler, because there was nothing else the conversation was for.
 *
 * ## The type is chosen, and only pre-filled by guessing
 *
 * Three ways in were considered. Guessing from length and content is the one
 * that recreates the problem, because a wrong guess is invisible and this whole
 * entry is about an invisible wrong assumption. Asking at the start of the
 * recording puts a question in front of somebody who is trying to start
 * recording. So the guess fills the choice IN THE PANEL that already asks which
 * model and which source - a pre-flight that exists, that is read, and that is
 * one click from being corrected before anything is spent.
 *
 * The guess is cheap and mostly right: a 1-1 comes from a template that stamps
 * its tag and names the note after itself. When it is not sure, it picks the
 * NARROWEST kind rather than the richest, because the failure that was reported
 * is a small conversation being given a big conversation's sections. Too little
 * is a quiet loss and too much is a loud one.
 *
 * ## The sections are removed from the SCHEMA, not discouraged
 *
 * Telling a model not to fill a field it has been handed is an instruction it
 * can weigh against everything else in the prompt. Not giving it the field is
 * not. See `schemaFor` in the main process.
 */

export type ConversationKind = 'one-to-one' | 'check-in' | 'meeting' | 'status'

export interface Conversation {
  id: ConversationKind
  /** What the panel calls it, in the panel's own language. */
  label: string
  /** The one line under it, so the choice can be made without guessing. */
  hint: string
  /** Whether the previous note in the folder is fetched and compared at all. */
  lastTime: boolean
  /** Whether the model is asked what nobody thought to ask. */
  questions: boolean
  /** What the instruction is told this conversation was. English, like the prompt. */
  says: string
}

export const CONVERSATIONS: readonly Conversation[] = [
  {
    id: 'one-to-one',
    label: '1-1',
    hint: 'återkommande, samma person',
    lastTime: true,
    questions: true,
    says:
      'This is a recurring one-to-one with the same person. What was agreed last time and is still open is the most useful line in the whole answer, and a question a good manager would wish they had asked is worth naming.'
  },
  {
    id: 'check-in',
    label: 'Avstämning',
    hint: 'ett avgränsat ämne',
    lastTime: false,
    questions: false,
    says:
      'This is a check-in about ONE bounded subject. Everything else that is open with this person is out of scope: do not raise it, do not observe that it went unmentioned, and do not treat its absence as something missed. It was not on the agenda, and there was no agenda. Answer about the thing the conversation was about and nothing else.'
  },
  {
    id: 'meeting',
    label: 'Möte',
    hint: 'flera personer',
    lastTime: false,
    questions: true,
    says:
      'Several people were in this. Whose promise a line was is the hard part and the part to get right: a commitment somebody else made is not the user\'s and does not belong in their list, however clearly it was made.'
  },
  {
    id: 'status',
    label: 'Statusuppdatering',
    hint: 'mest fakta, få beslut',
    lastTime: false,
    questions: false,
    says:
      'This is a status update. Most of it is reporting rather than deciding. Leave the decisions list empty rather than promoting a statement of where something stands into a decision that somebody made.'
  }
]

/** The narrowest kind, and so what an unrecognised conversation is treated as. */
export const CONVERSATION_FALLBACK: ConversationKind = 'check-in'

export function conversationOf(kind: ConversationKind | undefined): Conversation {
  return (
    CONVERSATIONS.find((candidate) => candidate.id === kind) ??
    CONVERSATIONS.find((candidate) => candidate.id === CONVERSATION_FALLBACK) ??
    CONVERSATIONS[0]
  )
}

/**
 * The words in a title that give the kind away.
 *
 * Order is the ranking: the first list that matches wins, so the strongest
 * signal is first. A word list is a blunt instrument and is meant to be - it
 * only has to be right often enough to save a click, because it is filling in a
 * control that will be looked at.
 */
const WORDS: readonly (readonly [ConversationKind, readonly string[]])[] = [
  ['one-to-one', ['1-1', '1:1', '1 on 1', 'one to one', 'onetoone', 'oneonone', '1on1']],
  ['status', ['status', 'uppdatering', 'update', 'rapport', 'report', 'standup', 'stand-up', 'daily']],
  [
    'meeting',
    [
      'möte',
      'meeting',
      'workshop',
      'retro',
      'planering',
      'planning',
      'demo',
      'kickoff',
      'kick-off',
      'grooming',
      'refinement',
      'styrgrupp'
    ]
  ],
  ['check-in', ['catchup', 'catch up', 'catch-up', 'avstämning', 'check-in', 'checkin', 'sync', 'snack']]
]

/**
 * Whether a word starts a word in the title, rather than merely appearing in one.
 *
 * A plain substring match put "Onboarding Catchup" in the meeting bucket,
 * because `onboarding` ends in `board`. Found by a test rather than by reading,
 * which is the argument for the test - the list is meant to be blunt, and blunt
 * is not the same as wrong. Only the LEFT edge is checked: `avstämningen` and
 * `möten` should still match, and requiring both edges would turn a word list
 * into a stemmer.
 */
function starts(text: string, word: string): boolean {
  let at = text.indexOf(word)
  while (at !== -1) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1])) {
      return true
    }
    at = text.indexOf(word, at + 1)
  }
  return false
}

/** The seeded 1-1 tag, which is the one signal stronger than any word in a title. */
const ONE_TO_ONE_TAG = 'tag-one-to-one'

/**
 * What this note's conversation probably was.
 *
 * The tag first, because it is not a guess: the 1-1 template stamps it, so a
 * note carrying it was started as a one-to-one on purpose. Only then the title,
 * which is a guess and is treated as one.
 */
export function guessConversation(title: string, tags: readonly string[] = []): ConversationKind {
  if (tags.includes(ONE_TO_ONE_TAG)) {
    return 'one-to-one'
  }
  const text = title.toLowerCase()
  for (const [kind, words] of WORDS) {
    if (words.some((word) => starts(text, word))) {
      return kind
    }
  }
  return CONVERSATION_FALLBACK
}
