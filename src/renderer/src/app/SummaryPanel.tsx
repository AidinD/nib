import { useState } from 'react'

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
  onRun: (source: SummarySource) => void
  onClose: () => void
}

export function SummaryPanel({
  transcripts,
  prompts,
  model,
  onModel,
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

      <p className="record-hint">
        {source === 'transcripts'
          ? 'Vad som sades, plus det du själv skrev. Beslut, åtgärdspunkter och frågor du inte ställde.'
          : 'Allt i noteringen, sammanfattat som text - inte som ett möte.'}
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
