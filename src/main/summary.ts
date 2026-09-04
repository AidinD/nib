import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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

/* --------------------------------------------------- the glossary -- */

/*
 * The words whisper gets wrong, and why correcting them here is the fix.
 *
 * Whisper mishears technical terms and proper nouns - which is precisely the
 * vocabulary that carries the meaning. Three confirmed instances in one week:
 * "easy level" for IC-level, twice in one 1-1; and two product names wrong
 * throughout another note, including in the summary's own decisions and its KPI.
 *
 * ## Why the summary is a separate injury, and the argument for fixing it here
 *
 * A transcript LOOKS unreliable. It is choppy, it mislabels speakers, it drops
 * words, so it is read with suspicion. A summary does not look like that: it is
 * clean, coherent, confident prose. A mishearing that passes into it is
 * laundered - it goes from obviously broken text into something that reads as
 * fact. Someone reading the note in six months sees a KPI of 32 daily users for
 * a product whose name does not exist, and never connects it to the one that
 * does.
 *
 * ## The transcript is NOT rewritten
 *
 * The hard constraint. It is a record of what was HEARD, and editing a record is
 * a different and worse kind of damage than leaving it wrong. Only the summary
 * changes, and it says so - see `corrections`.
 *
 * ## Data in a file, not a constant here
 *
 * Because the list is his, it grows, and it holds colleague and client names.
 * That last part is why the seed below is short: this repository is public and
 * has a pre-push hook that refuses private names, so the terms that matter most
 * cannot live in this file at all. They go in the glossary itself, which is in
 * the notebook's own directory and is not version-controlled.
 *
 * Deriving names from Tend's role map would be nicer and is deliberately not
 * done: Tend reads Nib, not the other way round, and this is not the change that
 * should invent a dependency in the other direction.
 */

/** The file, beside the notebook, one term per line. */
const GLOSSARY_FILE = 'glossary.txt'

/**
 * What a fresh notebook starts with.
 *
 * Public names only, and that is a constraint rather than a judgement about what
 * is worth correcting - see above. The header written with it is what tells him
 * where to add the rest.
 */
const SEED = ['Roblox', 'Meta', 'Jot', 'Nib', 'Tend', 'Helm']

const HEADER = [
  '# Words this notebook uses, one per line.',
  '#',
  '# The summary corrects the transcript against this list where what was heard',
  '# is a plausible mishearing of one of these - the way "easy level" is what a',
  '# transcriber makes of "IC-level". It says which corrections it applied, so',
  '# you can see whether a term is missing from this file.',
  '#',
  '# The transcript itself is never rewritten. It is the record of what was heard.',
  '#',
  '# Add your own project, product and colleague names here. They belong in this',
  '# file rather than in the app, which is open source: this file is yours and is',
  '# not part of it.',
  '#',
  '# Lines starting with # are ignored.',
  ''
]

/**
 * The glossary, seeded on first read.
 *
 * Read on every summary rather than cached, so editing the file takes effect on
 * the next press instead of on the next restart - which is the difference
 * between a list he maintains and a list he gives up on.
 *
 * Never throws. A glossary that cannot be read is a summary without corrections,
 * which is exactly what happened before this existed; failing the whole call over
 * it would trade a small loss for the entire feature.
 *
 * The directory is a parameter rather than resolved here, so this module knows
 * nothing about where the notebook lives - the same reason every other input to
 * this file arrives on the request. It is also what lets a test hand over a
 * scratch directory instead of reaching for the real notebook.
 */
export function readGlossary(dir: string): string[] {
  const path = join(dir, GLOSSARY_FILE)
  try {
    if (!existsSync(path)) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(path, [...HEADER, ...SEED, ''].join('\n'), 'utf8')
    }
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      // A cap, so a pasted document cannot become the whole prompt.
      .slice(0, 200)
  } catch {
    return []
  }
}

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
    },
    answers: {
      type: 'array',
      description:
        'Only when the note carried its own questions. One entry per question the meeting actually answered - leave a question out entirely rather than filling it.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'answer'],
        properties: {
          id: { type: 'string', description: 'The id of the question, exactly as given.' },
          answer: {
            type: 'string',
            description:
              'What the conversation said in answer to that whole line, including every question on it. One short paragraph.'
          }
        }
      }
    },
    corrections: {
      type: 'array',
      description:
        'Only the glossary corrections actually applied to this summary. Empty when none were. Never a term you did not use.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heard', 'meant'],
        properties: {
          heard: { type: 'string', description: 'The words as the transcript has them.' },
          meant: { type: 'string', description: 'The glossary term written instead.' }
        }
      }
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
   * The words this notebook uses, so a mishearing does not reach the summary.
   *
   * Passed in rather than read here, so the caller decides which notebook - and
   * so a test can hand over a list without a data directory existing.
   */
  glossary?: string[]
  /**
   * The note's own questions, when it was started from a template that has any.
   *
   * Keyed by id rather than by their text, because a prompt line holds more than
   * one question and the answer has to come back to the line - see `notePrompts`.
   */
  prompts?: { id: string; heading: string; question: string; existing: string }[]
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
    answers?: { id: string; answer: string }[]
    corrections?: { heard: string; meant: string }[]
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

  /*
   * The note's own questions, asked as a second job in the same call.
   *
   * One call rather than two because the transcript is what this costs - sending
   * it twice to ask a second thing about the same words doubles the bill - and
   * because the two halves of the answer should agree with each other, which two
   * independent calls cannot promise.
   *
   * The line is the unit, and that took being told. A prompt in the 1-1 template
   * holds two questions and has one place for an answer, so answering "per
   * question" would put two half-answers where a person asks one thing. The id
   * is what carries that: it addresses the line, not the words in it.
   *
   * Four rules, and each one is a failure that would otherwise happen. Leave a
   * question out rather than answering it from what a good answer would be -
   * these are questions the user chose to ask, and a plausible invention under
   * one that never came up is worse than a blank, because a blank is readable as
   * "we did not get to it". Do not restate what they already wrote there; they
   * can see it. And answer about the OTHER person: a 1-1's questions are asked
   * of them, so the answer is what they said, not what the user said back.
   */
  const questions =
    request.prompts === undefined || request.prompts.length === 0
      ? ''
      : [
          '',
          '--- THE QUESTIONS THIS NOTE CAME WITH ---',
          'The note was started from a template whose prompts are the questions the user meant to ask. Answer them in `answers`, one entry per prompt below, keyed by its id.',
          'A prompt is one LINE and usually holds several questions. Answer the whole line as one short paragraph rather than question by question - that is how it was asked.',
          'These questions are asked OF THE OTHER PERSON, so the answer is what that person said about it. Not what the user replied.',
          'Leave a prompt out unless the conversation actually answered it. Silence is honest; an invention is not, and this is the half of the note that gets read back in six months.',
          'Where something is already written under a prompt, that is their own judgement made while it was happening and it stands. Add what the conversation adds and do not repeat what is there. If it adds nothing, leave the prompt out.',
          '',
          ...request.prompts.map((prompt) => {
            const wrote = prompt.existing.trim()
            return (
              `[${prompt.id}] under "${prompt.heading}": ${prompt.question}` +
              (wrote.length > 0 ? `\n    already written there: ${wrote.replace(/\n/g, ' / ')}` : '')
            )
          })
        ].join('\n')

  /*
   * The words this notebook uses, and the licence to fix them - which is narrow
   * on purpose.
   *
   * Three rules, and each one is a way this goes wrong. Only a plausible
   * MISHEARING: a glossary term is not permission to replace a word that is
   * simply a different word, and "Meta" in the list must not turn every
   * "better" into it. Only the summary: the transcript is a record of what was
   * heard and rewriting a record is worse than leaving it wrong, so the model is
   * told plainly that it is not editing one. And report what was applied, so a
   * summary that diverges from its own transcript says why - the whole point of
   * this note format is keeping "what was said" apart from "what was inferred",
   * and a silent correction is exactly the kind of thing that blurs it.
   *
   * Reporting also does a second job: it is how he finds out the list is missing
   * a term, which is the only feedback a glossary can give.
   *
   * Meetings only, and deliberately. A note summarised as a note is mostly HIS
   * OWN typing, and correcting a man's spelling of his own project back at him
   * is not what this is for - the damage reported was all in meeting summaries,
   * where the words came out of a microphone rather than off a keyboard.
   */
  const glossary =
    request.glossary === undefined || request.glossary.length === 0
      ? ''
      : [
          '',
          '--- THE WORDS THIS NOTEBOOK USES ---',
          'The transcript comes from speech recognition, which reliably mishears technical terms and proper nouns - the exact words that carry the meaning. These are the spellings this notebook uses:',
          request.glossary.map((term) => `  ${term}`).join('\n'),
          '',
          'Where the transcript has something that is a plausible MISHEARING of one of these, write the glossary spelling in your answer instead. "easy level" for IC-level is the shape of it: same sounds, wrong words.',
          'Only a mishearing. A word that merely resembles a glossary term, or that you would have phrased differently, is left exactly as it is - this is not a find-and-replace and not licence to tidy anybody\'s wording.',
          'You are not editing the transcript. It stays as it is, wrong words and all, because it is the record of what was heard. Only your answer is corrected.',
          'List every correction you actually applied in `corrections`, as heard and meant. Nothing you did not use, and an empty list when you corrected nothing.'
        ].join('\n')

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
    glossary,
    questions,
    '',
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
