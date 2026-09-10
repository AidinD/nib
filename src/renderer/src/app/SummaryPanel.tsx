import { useState } from 'react'
import { CONVERSATIONS } from '@shared/conversation'
import type { ConversationKind } from '@shared/conversation'

/*
 * What to summarise, and with which model.
 *
 * The button used to be disabled until a note held a transcript, which is
 * unreadable from the outside: a control that is grey for reasons it does not
 * explain teaches you nothing except not to press it. Now it always opens this,
 * and this says what it is about to do.
 *
 * It also settles a question the old button could not ask. A note may hold
 * several recordings - a meeting stopped and restarted, two calls in one
 * afternoon - and the first version silently summarised the first one only.
 */

export type SummarySource = 'transcripts' | 'note'

/**
 * The tiers worth offering, cheapest first.
 *
 * Compressing a transcript into a fixed structure is extraction, and Haiku does
 * it about as well as anything - which is why it is the default. The larger
 * models earn their price on the parts that are inference rather than reading: a
 * promise phrased as a maybe, what a disagreement was actually about, whether an
 * interview answer answered the question. That is a per-meeting judgement, so it
 * belongs here rather than in a settings panel.
 */
export const SUMMARY_MODELS = [
  { id: 'claude-haiku-4-5', label: 'Haiku', hint: 'snabb och billig' },
  { id: 'claude-sonnet-5', label: 'Sonnet', hint: 'läser mellan raderna' },
  { id: 'claude-opus-5', label: 'Opus', hint: 'när det är viktigt' }
] as const

interface SummaryPanelProps {
  /** How many transcripts the note holds - 0 hides that choice entirely. */
  transcripts: number
  /**
   * How many questions the note came with, when it came from a template.
   *
   * Said out loud because the summary will write into the note's own sections,
   * which is the one thing this button does that is not confined to the block it
   * adds at the top. A press that edits six places in a note you wrote should
   * announce that before it happens, not in a footnote afterwards.
   */
  prompts: number
  model: string
  onModel: (model: string) => void
  /**
   * What the note looks like it was, from its title and its tags.
   *
   * A guess, and pre-selected rather than applied: it decides which sections
   * the summary even has, and a wrong one that nobody saw is exactly the
   * failure this control exists to prevent - see `conversation.ts`.
   */
  conversation: ConversationKind
  onConversation: (conversation: ConversationKind) => void
  onRun: (source: SummarySource) => void
  onClose: () => void
}

/** What a conversation of this kind will actually come back with. */
function sections(conversation: ConversationKind): string {
  const chosen = CONVERSATIONS.find((option) => option.id === conversation)
  const parts = ['beslut', 'åtgärdspunkter']
  if (chosen?.lastTime === true) {
    parts.push('vad som är kvar sedan förra gången')
  }
  if (chosen?.questions === true) {
    parts.push('frågor modellen hade ställt')
  }
  const last = parts.pop()
  return `Vad som sades, plus det du själv skrev. Ger ${parts.join(', ')} och ${last}.`
}

export function SummaryPanel({
  transcripts,
  prompts,
  model,
  onModel,
  conversation,
  onConversation,
  onRun,
  onClose
}: SummaryPanelProps): React.JSX.Element {
  const [source, setSource] = useState<SummarySource>(transcripts > 0 ? 'transcripts' : 'note')

  return (
    <div className="summary-panel">
      <span className="record-title">Sammanfatta</span>

      {/* Only worth asking when there is something to choose between. A note with
          no recording has one answer, and offering it as a question is noise. */}
      {transcripts > 0 && (
        <div className="summary-sources">
          <button
            type="button"
            className={`summary-source${source === 'transcripts' ? ' is-on' : ''}`}
            onClick={() => setSource('transcripts')}
          >
            {transcripts === 1 ? 'Transkriptet' : `Alla ${transcripts} transkript`}
          </button>
          <button
            type="button"
            className={`summary-source${source === 'note' ? ' is-on' : ''}`}
            onClick={() => setSource('note')}
          >
            Hela noteringen
          </button>
        </div>
      )}

      {/*
        What kind of conversation it was, above the model.
        
        Above because it changes what you get rather than how well: the model
        picker chooses how hard to think about the same questions, and this
        chooses which questions are asked at all. Only for a transcript - the
        whole notion is about a conversation, and summarising a page of notes
        is not one.
      */}
      {/*
        Two grids of the same buttons, one above the other, with a selection in
        each - which read as one grid with two selections until they were
        labelled. Four words is the whole fix; the alternative was giving one of
        them chrome of its own, which would have said they were different KINDS
        of choice when they are the same kind about different things.
      */}
      {source === 'transcripts' && (
        <span className="summary-caption">Vad för slags samtal?</span>
      )}
      {source === 'transcripts' && (
        <div className="summary-kinds">
          {CONVERSATIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`summary-kind${conversation === option.id ? ' is-on' : ''}`}
              onClick={() => onConversation(option.id)}
            >
              <span className="summary-kind-name">{option.label}</span>
              <span className="summary-kind-hint">{option.hint}</span>
            </button>
          ))}
        </div>
      )}

      <span className="summary-caption">Hur noga?</span>
      <div className="summary-models">
        {SUMMARY_MODELS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`summary-model${model === option.id ? ' is-on' : ''}`}
            onClick={() => onModel(option.id)}
          >
            <span className="summary-model-name">{option.label}</span>
            <span className="summary-model-hint">{option.hint}</span>
          </button>
        ))}
      </div>

      {/*
        What it will produce, said in terms of the sections that will exist.
        
        The old line promised "beslut, åtgärdspunkter och frågor du inte
        ställde" whatever the note was, which is the promise that was being
        broken. Now it says what this choice actually buys.
      */}
      <p className="record-hint">
        {source === 'transcripts' ? sections(conversation) : 'Allt i noteringen, sammanfattat som text - inte som ett möte.'}
      </p>

      {/* Only for a transcript, and only when the note has questions of its own.
          Summarising the note itself cannot answer them - the answer would come
          out of the same text the questions are sitting in. */}
      {source === 'transcripts' && prompts > 0 && (
        <p className="record-hint">
          Fyller också i {prompts === 1 ? 'noteringens egna fråga' : `noteringens ${prompts} egna frågor`}{' '}
          där samtalet besvarar {prompts === 1 ? 'den' : 'dem'}. Det du skrivit själv står kvar.
        </p>
      )}

      <div className="record-actions">
        <button type="button" className="record-cancel" onClick={onClose}>
          Avbryt
        </button>
        <button type="button" className="record-go" onClick={() => onRun(source)}>
          Sammanfatta
        </button>
      </div>
    </div>
  )
}
