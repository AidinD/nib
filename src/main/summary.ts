import { ask } from 'keel/claude'

/*
 * Turning a meeting into something you can act on.
 *
 * The transcript is the raw material and it is deliberately not the product: a
 * 45-minute meeting is nine thousand words, and nobody reads their own meetings
 * back. What is worth having is what was decided, what you promised, and what you
 * did not ask.
 *
 * This runs through keel's `ask`, which borrows Claude Code's own sign-in - so
 * there is no second credential to store, and the spend is the one the user
 * already has rather than a separate bill they would have to set up.
 *
 * It is the ONLY part of this feature that leaves the machine, which is why it is
 * a button rather than a step: the audio never leaves it at all - it is recorded,
 * transcribed and deleted here - and this sends text the user can read first.
 */

/** What the model must answer with. A schema, so the reply is data rather than prose to parse. */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'decisions', 'actions', 'questions', 'people'],
  properties: {
    summary: {
      type: 'string',
      description: 'Three to six sentences. What the meeting was about and where it landed.'
    },
    decisions: {
      type: 'array',
      items: { type: 'string' },
      description: 'What was actually settled. Empty when nothing was.'
    },
    actions: {
      type: 'array',
      description: 'What the note-taker committed to. Their promises, not the other side\'s.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'implied'],
        properties: {
          text: { type: 'string', description: 'One line, in the first person, as a task.' },
          implied: {
            type: 'boolean',
            description: 'True when it was a promise in effect rather than in words.'
          }
        }
      }
    },
    questions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Questions worth having asked and nobody did. Empty if none stand out.'
    },
    people: {
      type: 'array',
      items: { type: 'string' },
      description: 'People named in the conversation who were not in it.'
    },
    lastTime: {
      type: 'string',
      description:
        'Only when a previous meeting was supplied: what was agreed then and is unresolved now.'
    }
  }
} as const

/** What is being summarised, which decides both the schema and the instruction. */
export type SummaryKind = 'meeting' | 'note'

export interface SummaryRequest {
  /** A meeting has decisions and promises; a page of notes has neither. */
  kind?: SummaryKind
  /** The words, with their timestamps. */
  transcript: string
  /** What the user typed themselves during the meeting - weighted above the transcript. */
  notes: string
  /** The previous meeting with the same person, when there is one. */
  previous?: string
  /**
   * The names the transcript labels its turns with, when it has any.
   *
   * Present only for a recording that kept the two sides on separate channels.
   * Worth telling the model about, because it changes how much of "whose promise
   * was that" it has to infer from the words - see the instruction.
   */
  speakers?: { mine: string; theirs: string }
  language: 'sv' | 'en'
  model: string
}

export interface SummaryResult {
  ok: boolean
  reason?: string
  /** Which model actually answered - not necessarily the one that was asked for. */
  model?: string
  value?: {
    summary: string
    decisions: string[]
    actions: { text: string; implied: boolean }[]
    questions: string[]
    people: string[]
    lastTime?: string
  }
  costUsd?: number | null
}

/**
 * The instruction.
 *
 * Two things in it are worth defending. The user's own notes outrank the
 * transcript, because those are the parts they had already decided were worth
 * writing down while it was happening - a model reading only the words would
 * weight a long tangent over a line someone typed deliberately. And an action
 * point is only theirs: "I'll look into it" is a promise, "he'll send it over" is
 * not, and a list that mixes the two is a list you cannot act on.
 */
function instruction(request: SummaryRequest): string {
  const language = request.language === 'sv' ? 'Swedish' : 'English'

  /*
   * A note that is not a meeting gets a different question.
   *
   * Asking "what did you commit to" of a page of book notes produces invented
   * promises - the shape of the answer teaches the model what to look for, and a
   * meeting-shaped schema over anything else is a request to hallucinate one.
   */
  if (request.kind === 'note') {
    return [
      `You are reading one note from somebody's notebook. Answer in ${language}, in their voice - plain, specific, no filler.`,
      '',
      'Summarise what it says. Pull out the points that would be worth remembering in a month, and anything left open.',
      'An action is something the writer still has to DO - a task ahead of them, in the future. It is not something they did. A note written in the past tense about something that already happened contains no actions at all, however many verbs it has: "I presented three arguments" is what happened, not a thing to do. If nothing is waiting to be done, return an empty list.',
      'Leave a list empty rather than filling it. Most notes contain no decisions and no promises, and inventing them is worse than an empty section.',
      '',
      '--- THE NOTE ---',
      request.notes
    ].join('\n')
  }

  /*
   * What the speaker labels are, and what they are not.
   *
   * They come from which device the sound arrived on - the user's own microphone
   * against the call's own audio - so they are bookkeeping rather than voice
   * recognition, and they answer the one question this whole instruction is
   * built around: whose promise was that. Without them the model infers it from
   * the words, which is exactly where it goes wrong.
   *
   * The caveat is told rather than hidden. On speakers the microphone also hears
   * the far side, and a turn the recording could not separate is labelled `?`. A
   * model told the labels were perfect would resolve that silently; told what
   * they actually are, it can fall back on the words.
   */
  const labels =
    request.speakers === undefined
      ? ''
      : `The transcript is labelled by speaker: "${request.speakers.mine}" is the user and "${request.speakers.theirs}" is the other side. The labels come from which microphone the sound arrived on rather than from recognising anybody's voice, so they are reliable about WHOSE side spoke - use them to decide whose promise a line is. A turn marked "?" is one the recording could not separate; fall back on the words there.`

  /*
   * A screenshot in the transcript is a time and nothing more.
   *
   * The model is told `[14:32] (skärmbild)` because that is honestly all this
   * call carries: `ask` runs with its tools off and sends text, so nothing here
   * has looked at the picture. Saying so is what stops it describing one.
   */
  const marks =
    'A line like "[14:32] (skärmbild)" marks a screenshot the user pasted at that moment, and "[14:32] ..." marks something they typed then. You cannot see the screenshots - never describe what one showed. Treat them only as evidence that the moment mattered.'

  return [
    `You are reading a transcript of a meeting the user was in. Answer in ${language}, in their voice - plain, specific, no filler.`,
    '',
    'What matters, in order:',
    '- Their own notes below outrank the transcript. They typed those while it was happening, which is a judgement the transcript does not contain.',
    '- An action point is something THEY committed to. "I\'ll look into it" counts, and counts as implied when the words were softer than the commitment. What the other person promised is not theirs and does not belong in that list.',
    '- Decisions are what was settled, not what was discussed.',
    '- A question is worth listing only if a good manager would wish they had asked it.',
    '',
    labels,
    marks,
    '',
    'Do not invent. A transcript is imperfect and a name heard wrong is worse than a name left out - if you cannot tell what was said, leave it out rather than guess.',
    request.previous !== undefined && request.previous.length > 0
      ? '\nThe previous meeting with this person is included. Say plainly what was agreed then and has not been resolved now - that is the most useful thing in this whole answer.'
      : '',
    '',
    '--- THEIR OWN NOTES ---',
    request.notes.trim().length > 0 ? request.notes : '(they wrote nothing during the meeting)',
    '',
    request.previous !== undefined && request.previous.length > 0
      ? `--- THE PREVIOUS MEETING ---\n${request.previous}\n`
      : '',
    '--- TRANSCRIPT ---',
    request.transcript
  ].join('\n')
}

export async function summarise(request: SummaryRequest): Promise<SummaryResult> {
  const result = await ask({
    prompt: instruction(request),
    model: request.model,
    schema: SCHEMA as unknown as Record<string, unknown>,
    // Fifteen minutes: a long transcript on a busy machine is not a hung call,
    // and the default would give up on exactly the meetings worth summarising.
    timeoutMs: 15 * 60 * 1000
  })

  if (!result.ok) {
    return { ok: false, reason: result.reason }
  }
  return { ok: true, value: result.value, model: result.model, costUsd: result.costUsd }
}
