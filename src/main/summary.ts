import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ask } from 'keel/claude'

// Relative rather than through the `@shared` alias, so the tests can import
// this file directly: the node test runner resolves paths, not tsconfig.
import { conversationOf } from '../shared/conversation.ts'
import type { ConversationKind } from '../shared/conversation.ts'

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
 * transcribed and deleted here - and this sends text the user can read first,
 * with the screenshots they pasted into the note during the meeting.
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
  required: ['summary', 'decisions', 'actions', 'questions', 'people', 'theirs'],
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
    nextTime: {
      type: 'array',
      items: { type: 'string' },
      description:
        'What the user should have in front of them before the NEXT conversation with this person: promises either side made that come due, questions left open, things to follow up on. One short line each. Empty when nothing carries over.'
    },
    theirs: {
      type: 'array',
      description:
        "The OTHER person's contribution: what they did well and what less well. Usually empty or one or two points - empty is the normal answer when nothing stands out, and a point invented to fill the list is worse than none. Never balance a strength with a weakness for its own sake.",
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict', 'point', 'quote'],
        properties: {
          verdict: { type: 'string', enum: ['good', 'less good'] },
          point: {
            type: 'string',
            description: 'One sentence: what they did, and why it helped or did not.'
          },
          quote: {
            type: 'string',
            description:
              'Their own words, copied exactly from the transcript - the line this point rests on. A point you cannot quote them for does not belong here.'
          }
        }
      }
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

/**
 * The fields a conversation of this kind justifies.
 *
 * REMOVED from the schema rather than discouraged in the prompt, which is the
 * whole point. An instruction not to fill a field is something a model weighs
 * against everything else it has been told; a field that is not there is not.
 * "Sedan förra gången" after a fourteen-minute check-in listed four unrelated
 * open matters as things that went unraised - it was told what the conversation
 * was for, and it had a `lastTime` field to fill.
 *
 * Built per call. The object is small and the alternative is four frozen copies
 * that have to be kept in step with one another.
 */
export function schemaFor(
  kind: ConversationKind | undefined,
  source: 'meeting' | 'note' = 'meeting'
): Record<string, unknown> {
  const conversation = conversationOf(kind)
  const properties: Record<string, unknown> = { ...SCHEMA.properties }
  // The thread of a recurring conversation runs both ways: what was left open
  // last time, and what to pick up next time. A one-off has neither.
  if (!conversation.lastTime) {
    delete properties.lastTime
    delete properties.nextTime
  }
  if (!conversation.questions) {
    delete properties.questions
  }
  // The other person's part is judged from what they SAID, so a note summarised
  // as a note - his own typing - never has it, whatever kind it is filed as.
  if (!conversation.theirs || source === 'note') {
    delete properties.theirs
  }
  return {
    ...SCHEMA,
    required: SCHEMA.required.filter((name) => name in properties),
    properties
  }
}

/* ------------------------------------------------- the screenshots -- */

/**
 * A screenshot pasted during the meeting, ready to be looked at.
 *
 * `number` is the one in the transcript's `(skärmbild N)`, and it is kept even
 * when an earlier one could not be sent, so a gap is a gap rather than every
 * later picture sliding onto the wrong moment.
 */
export interface Screenshot {
  number: number
  mediaType: string
  /** Base64. */
  data: string
}

/** What the model can read. SVG and BMP are pasteable here and are not. */
const SCREENSHOT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
}

/**
 * At most this many. A meeting where someone pasted forty pictures is one where
 * the first twenty already say what was on screen, and each one is roughly a
 * page of transcript on the bill.
 */
export const MAX_SCREENSHOTS = 20

/** The API's ceiling is 5 MB of base64, which is 3.75 MB of file. */
const MAX_SCREENSHOT_BYTES = 3_750_000

/**
 * Read each screenshot the transcript numbers, skipping what cannot be sent.
 *
 * Skipped silently, not failed: a missing file, an SVG, or a picture too large
 * leaves that moment as it was before this existed - a label saying something
 * was on screen - and the instruction tells the model that a label without a
 * picture means exactly that. One unreadable asset is not a reason to refuse
 * the summary of a whole meeting.
 *
 * `resolve` turns an asset URL into a path, or null for anything that is not
 * one. Passed in so this can be tested without the app's storage.
 */
export function loadScreenshots(
  sources: string[],
  resolve: (src: string) => string | null
): Screenshot[] {
  const loaded: Screenshot[] = []
  for (const [index, src] of sources.entries()) {
    if (loaded.length >= MAX_SCREENSHOTS) {
      break
    }
    const path = resolve(src)
    const mediaType = SCREENSHOT_TYPES[path?.split('.').pop()?.toLowerCase() ?? '']
    if (path === null || mediaType === undefined) {
      continue
    }
    let bytes: Buffer
    try {
      bytes = readFileSync(path)
    } catch {
      continue
    }
    if (bytes.length === 0 || bytes.length > MAX_SCREENSHOT_BYTES) {
      continue
    }
    loaded.push({ number: index + 1, mediaType, data: bytes.toString('base64') })
  }
  return loaded
}

/** The label a screenshot is sent under - the same words the transcript uses. */
export function screenshotLabel(number: number): string {
  return `(skärmbild ${number})`
}

/** What is being summarised, which decides both the schema and the instruction. */
export type SummaryKind = 'meeting' | 'note'

export interface SummaryRequest {
  /** A meeting has decisions and promises; a page of notes has neither. */
  kind?: SummaryKind
  /**
   * What kind of conversation the recording was.
   *
   * Chosen in the panel, pre-filled by guessing from the note - see
   * `conversation.ts`. Absent means the narrowest kind, which is the safe way
   * round: the reported failure was a small conversation being handed a big
   * one's sections.
   */
  conversation?: ConversationKind
  /** The words, with their timestamps. */
  transcript: string
  /**
   * The `src` of each screenshot the transcript numbers, in that order - what
   * the renderer sends. Turned into `images` in the main process, which is the
   * side that can read the files.
   */
  screenshots?: string[]
  /** The screenshots that could be read, by the number the transcript gives them. */
  images?: Screenshot[]
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
  /**
   * The voices a one-microphone recording was split into, by the names they go
   * by in the note - "Speaker 2" until somebody renamed it.
   *
   * Present only for an imported recording whose voices were told apart. Not
   * the same kind of label as `speakers`, and the instruction says so.
   */
  voices?: string[]
  language: 'sv' | 'en'
  model: string
}

/** One thing the other person did well or less well, and the words it rests on. */
export interface TheirPoint {
  verdict: 'good' | 'less good'
  point: string
  quote: string
}

/**
 * Only the points whose quote is really something the OTHER person said.
 *
 * The schema asks for a quote and the instruction says to copy it exactly, and
 * neither stops a model from writing a plausible one - or from quoting the
 * user's own line as the other person's. Checked here, in code, the way the
 * glossary correction is finished in code: a judgement about somebody's
 * contribution that rests on words they never said is the one thing this
 * section must not contain, and it reads exactly like one that is true.
 *
 * How a quote is matched, from the first real run: the model quoted across
 * several transcript lines and elided with "...", and an exact match against
 * the raw text failed every time, because each line carries a timestamp and a
 * speaker between the words. So the lines are read as `time Name: words`, the
 * user's own are set aside when the user's label is known, and the rest are
 * joined into one stream. Each piece of the quote between ellipses must be in
 * that stream, in order, compared without case or punctuation and allowing a
 * word in five to differ - see `matchPiece`. Fewer than three words is not a
 * quote of anything.
 *
 * @param labels Every speaker label the transcript uses, so a line's label is
 *   told apart from its first word. `user` is the one that is the user.
 */
export function keepQuoted(
  points: readonly TheirPoint[],
  transcript: string,
  speakers: { labels: readonly string[]; user?: string } = { labels: [] }
): TheirPoint[] {
  const flat = (text: string): string =>
    text
      .toLowerCase()
      .normalize('NFC')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()

  const known = new Set(speakers.labels.map((label) => label.trim()).filter((label) => label.length > 0))
  let speaking = ''
  const theirs: string[] = []
  for (const raw of transcript.split(/\r?\n/)) {
    let line = raw.trim().replace(/^\[?\d{1,2}(?::\d{2}){1,2}\]?\s*/, '')
    const colon = line.indexOf(': ')
    if (colon > 0 && known.has(line.slice(0, colon).trim())) {
      speaking = line.slice(0, colon).trim()
      line = line.slice(colon + 2)
    }
    if (speakers.user !== undefined && speaking === speakers.user) {
      continue
    }
    theirs.push(line)
  }
  const heard = flat(theirs.join(' ')).split(' ').filter((word) => word.length > 0)

  return points.filter((point) => {
    const pieces = point.quote
      .split(/\.{3}|…/)
      .map((piece) => flat(piece).split(' ').filter((word) => word.length > 0))
      .filter((piece) => piece.length > 0)
    if (pieces.reduce((sum, piece) => sum + piece.length, 0) < 3) {
      return false
    }
    let from = 0
    for (const piece of pieces) {
      const end = matchPiece(piece, heard, from)
      if (end < 0) {
        return false
      }
      from = end
    }
    return true
  })
}

/** How much of a quoted piece has to be there, word for word, in order. */
const QUOTE_SHARE = 0.8

/**
 * Where a quoted piece ends in what they said, or -1 when it is not there.
 *
 * Not an exact match, which the first real 1-1 showed is too strict to be
 * useful: the speaker said "ha" and the model wrote "har", and a sentence
 * condensed by one word failed outright. So a piece matches when at least four
 * in five of its words appear in that order inside a stretch not much longer
 * than the piece itself - enough slack for spelling and a dropped "alltså",
 * none for words that were never said.
 */
function matchPiece(piece: readonly string[], heard: readonly string[], from: number): number {
  const need = Math.ceil(piece.length * QUOTE_SHARE)
  const span = piece.length * 2 + 4
  const first = new Set(piece.slice(0, Math.max(1, piece.length - need + 1)))
  for (let start = from; start < heard.length; start += 1) {
    if (!first.has(heard[start])) {
      continue
    }
    // Longest common subsequence of the piece and this stretch, and where it ends.
    const window = heard.slice(start, start + span)
    let row = new Array<number>(window.length + 1).fill(0)
    for (const word of piece) {
      const next = new Array<number>(window.length + 1).fill(0)
      for (let at = 1; at <= window.length; at += 1) {
        next[at] = word === window[at - 1] ? row[at - 1] + 1 : Math.max(row[at], next[at - 1])
      }
      row = next
    }
    if (row[window.length] >= need) {
      const reached = row.findIndex((value) => value >= need)
      return start + reached
    }
  }
  return -1
}

/**
 * The labels a transcript uses, and which one is the user, for `keepQuoted`.
 *
 * Two-channel recordings name the user's side directly. A voice-split one has a
 * user only when a voice was renamed "Jag", which is what the rename panel
 * offers for exactly this; without it every line counts, and only the quote's
 * presence is checked.
 */
export function quotedSpeakers(request: Pick<SummaryRequest, 'speakers' | 'voices'>): {
  labels: string[]
  user?: string
} {
  const voices = request.voices ?? []
  const labels = [
    ...(request.speakers === undefined ? [] : [request.speakers.mine, request.speakers.theirs]),
    ...voices,
    '?'
  ]
  const user =
    request.speakers?.mine ?? voices.find((name) => name.trim().toLowerCase() === 'jag')
  return { labels, ...(user === undefined ? {} : { user }) }
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
    /** What to pick up next time - shown before the next conversation with this person. */
    nextTime?: string[]
    answers?: { id: string; answer: string }[]
    corrections?: { heard: string; meant: string }[]
    /** The other person's part, each point resting on their own quoted words. */
    theirs?: TheirPoint[]
  }
  costUsd?: number | null
}

/* ------------------------------------- making a correction stick -- */

/*
 * The model corrects the word where it is looking, and only there.
 *
 * Found in a 1-1 note on 2026-09-09. The summary said the product's name
 * correctly once and said it wrong four more times - in "Sedan förra gången", in
 * the questions, in an action point - and the line at the bottom reported the
 * correction as applied. It had been applied, to the paragraph the model
 * happened to be writing when it decided.
 *
 * Two separate failures produced that, and both are fixed here rather than by
 * asking the prompt more firmly.
 *
 * ## A correction the model reported but did not finish
 *
 * It listed three garbled variants of one product name, correctly identified,
 * and replaced them in the summary paragraph while the other fields kept theirs.
 * A model writing seven fields in one pass is not a find-and-replace and should
 * not be relied on as one - but once it has DECIDED that a word is a mishearing,
 * applying that decision to the rest of its own answer needs no judgement at
 * all. So code does it.
 *
 * ## A mishearing that looks like a real word
 *
 * The harder half. The transcript also had a spelling that is an ordinary
 * English word and a homophone of the term, and that one the model left alone
 * everywhere. The instruction is why: it is told, correctly, that a word merely
 * RESEMBLING a glossary term is not to be touched. A homophone is not a
 * resemblance, it is the same word heard by somebody who did not know how it was
 * spelled, and it is the most common shape this error takes - speech recognition
 * reaches for the word that exists.
 *
 * Caught by comparing consonants and ignoring which vowels were heard, which is
 * a crude stand-in for "sounds the same" and close enough for the job. It is
 * deliberately blind - it knows no English and reads no sentences - so the length
 * floor below is what keeps it safe rather than any cleverness.
 *
 * The transcript is still never touched. Only the answer, and every substitution
 * this makes is reported on the note's own line, so a correction stays as
 * visible as it was before code started making them.
 */

/** Vowels, Swedish included, as the thing to look past. */
const VOWELS = 'aeiouyåäö'

/**
 * Below this many characters a term is never matched by sound.
 *
 * The whole safety of the approach is here. `Tend` with its vowels ignored is
 * `T_nd`, which is `tand`, `tänd` and `tond` - and a glossary term is not licence
 * to rewrite the Swedish language around it. Every short term in the seed is a
 * word or a fragment of one (`Meta`, `Jot`, `Nib`, `Tend`, `Helm`), and every one
 * of them would misfire. Six letters with the consonants and the vowel positions
 * both fixed is specific enough that a collision is a real coincidence: `Roblox`
 * matches `Rablex` and nothing anybody writes.
 *
 * Short terms are still corrected - by the model, which can read the sentence
 * they are in. This pass is the part that cannot, so it takes only the cases
 * where not reading is safe.
 */
const SOUNDS_ALIKE_MIN = 6

/**
 * What a corrected word may still be carrying.
 *
 * The note that prompted this had the term with a genitive `s` and again inside a
 * hyphenated compound. The hyphen is a boundary already; the genitive and the
 * definite forms are not, so they are listed - a term with an inflection on it is
 * the same term.
 */
const CARRIED = '(?:s|es|n|en|et|ns|ar|arna|erna)?'

/** Below this a reported mishearing is not applied again - see `reportedFixes`. */
const HEARD_MIN = 4

/**
 * A term as a pattern that ignores which vowels were heard.
 *
 * Null for anything this must not fuzz: too short, or not a single plain word. A
 * term with a space or a digit in it is not a word whose vowels can be
 * generalised - `IC-level` fuzzed would match far more than it should - and those
 * are left entirely to the model.
 */
function soundsLike(term: string): RegExp | null {
  if (term.length < SOUNDS_ALIKE_MIN || !new RegExp(`^[a-z${VOWELS}]+$`, 'i').test(term)) {
    return null
  }
  const runs = term.match(new RegExp(`[${VOWELS}]+|[^${VOWELS}]+`, 'gi')) ?? []
  const body = runs
    .map((run) => (new RegExp(`[${VOWELS}]`, 'i').test(run[0]) ? `[${VOWELS}]+` : run.toLowerCase()))
    .join('')
  // A letter or a digit on either side rules the match out, so a term sitting
  // inside a longer word is left alone; a hyphen does not, because a compound
  // built on the term is still the term.
  return new RegExp(`(?<![\\p{L}\\p{N}])(${body})(${CARRIED})(?![\\p{L}\\p{N}])`, 'giu')
}

/** The glossary's spelling, capitalised the way the word it replaces was. */
function cased(term: string, found: string): string {
  const upper = found[0] === found[0].toUpperCase() && found[0] !== found[0].toLowerCase()
  return upper ? term[0].toUpperCase() + term.slice(1) : term
}

/**
 * The corrections the model said it applied, as patterns to apply everywhere.
 *
 * `heard` arrives improvised. Asked for the words as the transcript has them, it
 * answered with three variants slashed together in one string, so the value is
 * split rather than trusted as a literal.
 *
 * The floor matters here for the same reason as above but more sharply: a
 * reported `heard` of `en` or `av` applied across a Swedish summary would be
 * vandalism. Four characters, and whole words only.
 */
function reportedFixes(
  corrections: { heard: string; meant: string }[]
): { from: RegExp; to: string }[] {
  const fixes: { from: RegExp; to: string }[] = []
  for (const correction of corrections) {
    const meant = correction.meant.trim()
    if (meant.length === 0) {
      continue
    }
    for (const piece of correction.heard.split(/[/,;]|\bor\b|\beller\b/i)) {
      const heard = piece.trim()
      if (heard.length < HEARD_MIN || heard.toLowerCase() === meant.toLowerCase()) {
        continue
      }
      const escaped = heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      fixes.push({
        from: new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'),
        to: meant
      })
    }
  }
  return fixes
}

/** Every field of the answer that is prose, so none of them is missed. */
function texts(value: NonNullable<SummaryResult['value']>): string {
  return [
    value.summary,
    ...value.decisions,
    ...value.actions.map((action) => action.text),
    ...value.questions,
    ...value.people,
    value.lastTime ?? '',
    ...(value.nextTime ?? []),
    ...(value.answers ?? []).map((answer) => answer.answer),
    ...(value.theirs ?? []).map((point) => point.point)
  ].join(' ')
}

/* ------------------------------------ the model's own scaffolding -- */

/*
 * A closing tag left on the end of an answer.
 *
 * Three notes in a hundred and thirty-five end their summary with
 * `</summary>` and two of those with `</invoke>` under it. Neither is
 * anything the person said and neither is anything the app wrote: they are
 * the model's own tool-call scaffolding, typed INSIDE the field instead of
 * around it. `</invoke>` gives it away - that is the shape of a tool call,
 * not of a note about a meeting.
 *
 * It survives because the schema is enforced by the CLI, so the value that
 * comes back is a perfectly valid string; the fact that it ends in a tag is
 * invisible to everything that only checks the shape. And it survives being
 * rendered because the summary is escaped before it is written into the note,
 * exactly as it should be - so the reader gets the tag as literal text.
 *
 * ## Only an ORPHAN, and only at the end
 *
 * A note may legitimately contain markup - somebody writing about HTML would -
 * so this cannot simply delete tags. The test is whether the closing tag has an
 * opening one before it in the same field. Real markup comes in pairs; scaffolding
 * that leaked does not, because its opening half was consumed as scaffolding.
 * That distinction is what makes this safe to run on every answer rather than
 * on a list of names, and it is why nothing has to be updated when the model
 * starts leaking a tag nobody has seen yet.
 *
 * ## Not asked for in the prompt, deliberately
 *
 * A line telling it not to emit scaffolding asks the model to control something
 * it is doing by accident, in about two answers in a hundred, and would cost a
 * line of instruction on every call for a fix that works most of the time. This
 * works every time and costs nothing per call.
 */

/** One orphaned closing tag at the very end, or null when there is none. */
const TRAILING_TAG = /\s*<\/([a-zA-Z][\w-]*)\s*>\s*$/

/** An answer field with the model's leftover scaffolding taken off the end. */
export function tidy(text: string): string {
  let out = text
  for (;;) {
    const match = TRAILING_TAG.exec(out)
    if (match === null) {
      break
    }
    const opened = new RegExp(`<${match[1]}(?:[\\s/>])`, 'i')
    if (opened.test(out.slice(0, match.index))) {
      // Its opening half is right there, so this is somebody's markup.
      break
    }
    out = out.slice(0, match.index)
  }
  return out === text ? text : out.trimEnd()
}

/**
 * The whole answer, tidied.
 *
 * Every field rather than the summary alone: the leak lands wherever the model
 * happened to stop, and a decision or an answer ending in a tag reads exactly as
 * badly. Runs for a note as well as for a meeting, because this is an artefact
 * of the call rather than of what was being read.
 */
export function tidyAnswer(
  value: NonNullable<SummaryResult['value']>
): NonNullable<SummaryResult['value']> {
  const fixed: NonNullable<SummaryResult['value']> = {
    ...value,
    summary: tidy(value.summary),
    decisions: value.decisions.map(tidy),
    actions: value.actions.map((action) => ({ ...action, text: tidy(action.text) })),
    questions: value.questions.map(tidy),
    people: value.people.map(tidy),
    lastTime: value.lastTime === undefined ? undefined : tidy(value.lastTime),
    nextTime: value.nextTime?.map(tidy),
    answers: value.answers?.map((answer) => ({ ...answer, answer: tidy(answer.answer) })),
    theirs: value.theirs?.map((point) => ({ ...point, point: tidy(point.point) }))
  }
  return texts(fixed) === texts(value) ? value : fixed
}

/**
 * The same correction in every field, and honest about the ones code made.
 *
 * Runs over the whole answer rather than over the paragraph the model was
 * writing, which is the entire point: a name is right or wrong in a note, not
 * right under one heading and wrong under the next.
 *
 * Order is deliberate. The model's own reported corrections go first, because
 * those are decisions it made with the sentence in front of it; the sound match
 * runs after and cannot undo them, since a glossary term never matches itself.
 *
 * Returns a new value, or the one it was given when nothing moved. Nothing is
 * mutated.
 */
export function applyGlossary(
  value: NonNullable<SummaryResult['value']>,
  glossary: string[]
): NonNullable<SummaryResult['value']> {
  const reported = reportedFixes(value.corrections ?? [])
  const terms = glossary.map((term) => term.trim()).filter((term) => term.length > 0)
  const sound = terms
    .map((term) => ({ term, pattern: soundsLike(term) }))
    .filter((entry): entry is { term: string; pattern: RegExp } => entry.pattern !== null)
  const known = new Set(terms.map((term) => term.toLowerCase()))

  /** What this pass changed, so the note's own line can say so. */
  const made = new Map<string, string>()

  const fix = (text: string): string => {
    let out = text
    for (const { from, to } of reported) {
      out = out.replace(from, to)
    }
    for (const { term, pattern } of sound) {
      out = out.replace(pattern, (whole: string, word: string, carried: string) => {
        // A word that is itself a glossary term is somebody else's word rather
        // than a mishearing of this one, so two terms that rhyme cannot fight.
        if (known.has(word.toLowerCase())) {
          return whole
        }
        made.set(word, term)
        return cased(term, word) + carried
      })
    }
    return out
  }

  const before = texts(value)
  const fixed: NonNullable<SummaryResult['value']> = {
    ...value,
    summary: fix(value.summary),
    decisions: value.decisions.map(fix),
    actions: value.actions.map((action) => ({ ...action, text: fix(action.text) })),
    questions: value.questions.map(fix),
    people: value.people.map(fix),
    lastTime: value.lastTime === undefined ? undefined : fix(value.lastTime),
    nextTime: value.nextTime?.map(fix),
    answers: value.answers?.map((answer) => ({ ...answer, answer: fix(answer.answer) })),
    // The point, never the quote: the quote is the transcript's own words, and it
    // is what was checked against the transcript.
    theirs: value.theirs?.map((point) => ({ ...point, point: fix(point.point) }))
  }
  if (texts(fixed) === before) {
    return value
  }

  /*
   * The line at the bottom has to cover what code did too.
   *
   * A summary that quietly disagrees with its own transcript is the failure this
   * whole feature exists to prevent, and it does not become acceptable because
   * the disagreement was introduced deterministically. Only words actually
   * replaced are added - `made` is filled by the replacement itself - and only
   * where the model had not already reported that pair.
   */
  const said = new Set(
    (value.corrections ?? []).map(
      (correction) =>
        `${correction.heard.trim().toLowerCase()}|${correction.meant.trim().toLowerCase()}`
    )
  )
  const added = [...made]
    .filter(([heard, meant]) => !said.has(`${heard.toLowerCase()}|${meant.toLowerCase()}`))
    .map(([heard, meant]) => ({ heard, meant }))
  if (added.length > 0) {
    fixed.corrections = [...(value.corrections ?? []), ...added]
  }
  return fixed
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
export function instruction(request: SummaryRequest): string {
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
  const conversation = conversationOf(request.conversation)

  /*
   * The other person's part - only where the schema has the field for it.
   *
   * Asked for because the user reviews only their own side of these
   * conversations, and the summary used to do the same: everything in it was
   * about the user, so the other person - their own manager above all - was
   * implicitly assumed to have done it right. The emptiness is said twice, here
   * and in the schema, because a section waiting to be filled is how flaws get
   * invented to fill it.
   */
  const theirs =
    !conversation.theirs
      ? ''
      : [
          "In `theirs`, weigh the OTHER person's part the way the user's own part is usually weighed: what they did well and what less well - a clear explanation or a vague one, a decision made or pushed back, a promise kept or dropped, a question answered or deflected, support given or withheld.",
          "Every point must rest on something THEY said, and `quote` is those words copied exactly from the transcript. A point you cannot quote them for is left out, and a point quoted from the user's own lines is not about them.",
          'Most conversations have little or nothing that stands out, and then the list is empty. Do not balance praise with criticism, or the reverse, for its own sake.'
        ].join('\n')

  const labels =
    request.speakers === undefined
      ? ''
      : `The transcript is labelled by speaker: "${request.speakers.mine}" is the user and "${request.speakers.theirs}" is the other side. The labels come from which microphone the sound arrived on rather than from recognising anybody's voice, so they are reliable about WHOSE side spoke - use them to decide whose promise a line is. A turn marked "?" is one the recording could not separate; fall back on the words there.`

  /*
   * Voices told apart by how they sound, on a recording made with one
   * microphone in the room.
   *
   * Weaker than the channel labels above, and the model is told exactly how:
   * the split comes from clustering voices, so it can be wrong where a turn
   * changes or two people talk at once, and a voice still called "Speaker N"
   * was never named. "Jag" is the name the rename panel offers for the user's
   * own voice, so that is the one name that says whose promises are whose.
   */
  const named = (request.voices ?? []).filter((name) => name.trim().length > 0)
  const voiceLabels =
    named.length === 0
      ? ''
      : `The transcript was recorded on one microphone in a room and split by voice on this computer. Each turn is labelled with who spoke: ${named.map((name) => `"${name}"`).join(', ')}. The split comes from clustering how the voices sound, not from knowing who anybody is, so it is usually right but can be wrong near a change of speaker or where two people talk at once; when a label and the words disagree, trust the words. A label of the form "Speaker N" is a voice nobody has named - refer to it as that and do not guess a name for it. ${named.some((name) => name.trim().toLowerCase() === 'jag') ? 'The voice labelled "Jag" is the user.' : 'None of the labels says which voice is the user, so decide whose promise a line is from the words.'}`

  /*
   * The screenshots, and what the model may say about them.
   *
   * Pasted mid-meeting, a screenshot is what the words were pointing at - "den
   * här", "där", "om du går tillbaka" - so a summary that cannot see it has the
   * pointing and not the thing. They are attached after this text, each under
   * the label the transcript uses, so the model can read one together with what
   * was said around its moment.
   *
   * Two limits, both stated. Describe only what is visible: a screenshot is
   * evidence and the model must not narrate past it. And no section of their
   * own - they make the existing sections specific, they are not a fifth list.
   * A label whose picture could not be sent is told apart rather than hidden,
   * because the alternative is a model inventing what one showed.
   */
  const marks =
    request.images !== undefined && request.images.length > 0
      ? 'A line like "[14:32] (skärmbild 2)" marks a screenshot the user pasted at that moment, and "[14:32] ..." marks something they typed then. The screenshots are attached after the transcript, each under the same label. Read each one together with what was being said around its time: it shows what was on screen while it was discussed, which the words often only point at. Use what it shows where it makes the summary more specific - which view, which filter, which number - but describe only what is actually visible, and do not give the screenshots a section of their own. A label with no attached picture is one that could not be sent: treat it only as evidence that the moment mattered, and never describe it.'
      : 'A line like "[14:32] (skärmbild 1)" marks a screenshot the user pasted at that moment, and "[14:32] ..." marks something they typed then. You cannot see the screenshots - never describe what one showed. Treat them only as evidence that the moment mattered.'

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
    !conversation.questions || request.prompts === undefined || request.prompts.length === 0
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
          'A spelling that is an ordinary word IS a mishearing when it sounds the same as the term - that is the commonest form of this, because speech recognition reaches for the word that exists. Judge it by sound, not by whether the version in the transcript looks like a real word.',
          'Correct it in EVERY field you write, not only in the paragraph where you noticed. A name that is right in the summary and wrong in the questions is worse than one wrong throughout, because it reads as two different things.',
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
    conversation.questions
      ? '- A question is worth listing only if a good manager would wish they had asked it.'
      : '',
    '',
    /*
     * What kind of conversation this was, told rather than inferred.
     *
     * The sections it does not justify are already gone from the schema, so this
     * is not what stops them being written. It is what stops the model reaching
     * for them SIDEWAYS - a check-in whose summary paragraph quietly does the
     * work of the "Sedan förra gången" it no longer has a field for.
     */
    conversation.says,
    theirs,
    labels,
    voiceLabels,
    marks,
    '',
    'Do not invent. A transcript is imperfect and a name heard wrong is worse than a name left out - if you cannot tell what was said, leave it out rather than guess.',
    conversation.lastTime && request.previous !== undefined && request.previous.length > 0
      ? '\nThe previous meeting with this person is included. Say plainly what was agreed then and has not been resolved now - that is the most useful thing in this whole answer.'
      : '',
    '',
    '--- THEIR OWN NOTES ---',
    request.notes.trim().length > 0 ? request.notes : '(they wrote nothing during the meeting)',
    '',
    conversation.lastTime && request.previous !== undefined && request.previous.length > 0
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
    schema: schemaFor(
      request.kind === 'note' ? 'one-to-one' : request.conversation,
      request.kind === 'note' ? 'note' : 'meeting'
    ),
    // A meeting's only. A note summarised as a note is asked about its own text.
    images:
      request.kind === 'note'
        ? undefined
        : request.images?.map((image) => ({
            mediaType: image.mediaType,
            data: image.data,
            label: screenshotLabel(image.number)
          })),
    // Fifteen minutes: a long transcript on a busy machine is not a hung call,
    // and the default would give up on exactly the meetings worth summarising.
    timeoutMs: 15 * 60 * 1000
  })

  if (!result.ok) {
    return { ok: false, reason: result.reason }
  }
  /*
   * Its own scaffolding off the end, and then the corrections it started.
   *
   * The tidy runs on everything - a leaked tag is an artefact of the call, not
   * of what was being read. The glossary is meetings only, matching the
   * instruction: a note summarised as a note is mostly his own typing, and
   * correcting a man's spelling of his own project back at him is not what
   * this is for.
   */
  /*
   * The lists the schema may not have asked for.
   *
   * `schemaFor` removes `questions` for a conversation that does not justify
   * it, so the answer comes back without the field - and every reader of this
   * result spreads it. Filled in here at the boundary rather than made optional
   * all the way down: the answer HAS no questions, which is a different
   * statement from the answer maybe having them.
   */
  const received = (raw: NonNullable<SummaryResult['value']>): NonNullable<SummaryResult['value']> => ({
    ...raw,
    decisions: raw.decisions ?? [],
    actions: raw.actions ?? [],
    questions: raw.questions ?? [],
    people: raw.people ?? [],
    // Whatever the model wrote, only the points it can quote the transcript for.
    ...(raw.theirs === undefined
      ? {}
      : { theirs: keepQuoted(raw.theirs, request.transcript, quotedSpeakers(request)) })
  })

  const answered =
    result.value === undefined
      ? undefined
      : tidyAnswer(received(result.value as NonNullable<SummaryResult['value']>))
  const value =
    request.kind === 'note' || answered === undefined
      ? answered
      : applyGlossary(answered, request.glossary ?? [])
  return { ok: true, value, model: result.model, costUsd: result.costUsd }
}
