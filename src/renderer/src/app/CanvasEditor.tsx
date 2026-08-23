import { useCallback, useEffect, useRef, useState } from 'react'
import type { DrawingDoc, Stroke, StrokePoint, StrokeTool } from '@shared/types'

/** The ink colours the tool strip offers, straight from the design tokens. */
const INKS = ['#e8e9ec', '#6f9cff', '#ffb054', '#5fd0a0', '#b98cff', '#ff6b6b'] as const

const TOOLS: Array<{ id: StrokeTool; label: string }> = [
  { id: 'pen', label: 'Pen' },
  { id: 'highlighter', label: 'Highlighter' },
  { id: 'eraser', label: 'Eraser' }
]

/**
 * Per-tool nib multipliers and compositing.
 *
 * A highlighter is wide and translucent; an eraser is wider still and takes ink
 * away rather than adding any, which `destination-out` does natively - so an
 * erased stroke is a stroke like any other and replays in order.
 */
const TOOL_STYLE: Record<StrokeTool, { multiplier: number; alpha: number; erase: boolean }> = {
  pen: { multiplier: 1, alpha: 1, erase: false },
  highlighter: { multiplier: 3, alpha: 0.28, erase: false },
  eraser: { multiplier: 2.2, alpha: 1, erase: true }
}

/** Ignore touch for this long after a pen lifts - the palm that follows the nib. */
const PALM_GRACE = 400

/**
 * How pressure becomes width.
 *
 * A stylus reports 0..1 and tapers; a mouse reports a constant 0.5 and so draws
 * evenly. The floor keeps a feather-light touch visible instead of dropping the
 * stroke to nothing.
 */
function strokeWidth(width: number, tool: StrokeTool, pressure: number): number {
  return Math.max(0.6, width * TOOL_STYLE[tool].multiplier * (0.35 + 1.3 * pressure))
}

/** Replay a stroke onto a context. Used for live drawing and for redraws alike. */
function paintStroke(context: CanvasRenderingContext2D, stroke: Stroke): void {
  const style = TOOL_STYLE[stroke.tool]
  context.save()
  context.globalCompositeOperation = style.erase ? 'destination-out' : 'source-over'
  context.globalAlpha = style.alpha
  context.strokeStyle = stroke.color
  context.lineCap = 'round'
  context.lineJoin = 'round'

  if (style.alpha < 1) {
    /*
     * A translucent tool is drawn as ONE path, at the stroke's mean pressure.
     *
     * Per-segment strokes compound their alpha where the round caps overlap, and
     * a highlighter sweep came out as a string of beads rather than a band. One
     * path composites once. The cost is that a highlighter does not taper with
     * pressure - which is fair, since a real one does not either.
     */
    const mean = stroke.points.reduce((total, point) => total + point.p, 0) / stroke.points.length
    context.lineWidth = strokeWidth(stroke.width, stroke.tool, mean)
    context.beginPath()
    context.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (const point of stroke.points.slice(1)) {
      context.lineTo(point.x, point.y)
    }
    context.stroke()
    context.restore()
    return
  }

  // Each segment is drawn on its own, because its width comes from the pressure
  // at that point - which is the whole reason a stylus stroke tapers.
  for (let i = 1; i < stroke.points.length; i++) {
    const from = stroke.points[i - 1]
    const to = stroke.points[i]
    context.beginPath()
    context.lineWidth = strokeWidth(stroke.width, stroke.tool, (from.p + to.p) / 2)
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.stroke()
  }

  // A single tap still leaves a mark.
  if (stroke.points.length === 1) {
    const only = stroke.points[0]
    context.beginPath()
    context.arc(only.x, only.y, strokeWidth(stroke.width, stroke.tool, only.p) / 2, 0, Math.PI * 2)
    context.fillStyle = stroke.color
    context.fill()
  }
  context.restore()
}

/**
 * The box the ink actually occupies, padded by the widest nib that drew it.
 *
 * Used to crop the rendered PNG. Exporting the whole surface produced a mostly
 * empty image, which then had to be scaled down to fit a note's 170px block -
 * so the drawing itself ended up tiny. Cropping to the ink means the thumbnail
 * shows the drawing, and the asset is smaller into the bargain.
 */
function inkBounds(strokes: Stroke[]): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let widest = 0

  for (const stroke of strokes) {
    widest = Math.max(widest, strokeWidth(stroke.width, stroke.tool, 1))
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }
  if (!Number.isFinite(minX)) {
    return null
  }
  const pad = widest / 2 + 8
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2
  }
}

interface CanvasEditorProps {
  drawingId: string
  onDone: (result: { drawingId: string; imageUrl: string }) => void
  onCancel: () => void
}

/**
 * The drawing surface, filling the editor pane.
 *
 * A drawing is a block inside a note, not a kind of note, so this opens over the
 * document and hands back a rendered image when it closes. The strokes are kept
 * in their own file; see DECISIONS for why both forms are stored.
 */
export function CanvasEditor({ drawingId, onDone, onCancel }: CanvasEditorProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const [tool, setTool] = useState<StrokeTool>('pen')
  const [width, setWidth] = useState(3)
  const [ink, setInk] = useState<string>(INKS[0])
  const [pointerType, setPointerType] = useState('mouse')
  const [pressure, setPressure] = useState(0)
  const [busy, setBusy] = useState(false)

  // The strokes are the document; the canvas is just where they are shown, and
  // is redrawn from these whenever the surface changes size.
  const strokes = useRef<Stroke[]>([])
  const undone = useRef<Stroke[]>([])
  const active = useRef<Stroke | null>(null)
  const size = useRef({ width: 0, height: 0 })
  const penSeenAt = useRef(0)
  const [counts, setCounts] = useState({ strokes: 0, undone: 0 })

  const context = useCallback((): CanvasRenderingContext2D | null => {
    return canvasRef.current?.getContext('2d') ?? null
  }, [])

  const redraw = useCallback(
    (withActive = false) => {
      const canvas = canvasRef.current
      const ctx = context()
      if (canvas === null || ctx === null) {
        return
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      // Backed at 2x device pixels, so the transform is set once and every
      // coordinate below is in CSS pixels.
      const ratio = canvas.width / size.current.width
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      for (const stroke of strokes.current) {
        paintStroke(ctx, stroke)
      }
      if (withActive && active.current !== null) {
        paintStroke(ctx, active.current)
      }
    },
    [context]
  )

  /** Size the backing store to the surface, then replay what is already drawn. */
  const resize = useCallback(() => {
    const canvas = canvasRef.current
    const surface = surfaceRef.current
    if (canvas === null || surface === null) {
      return
    }
    const box = surface.getBoundingClientRect()
    const scale = Math.min(2, window.devicePixelRatio || 1) * 2
    size.current = { width: box.width, height: box.height }
    canvas.width = Math.round(box.width * scale)
    canvas.height = Math.round(box.height * scale)
    canvas.style.width = `${box.width}px`
    canvas.style.height = `${box.height}px`
    redraw()
  }, [redraw])

  /** Load the drawing, if this block has been drawn in before. */
  useEffect(() => {
    let cancelled = false
    void window.nib.readDrawing(drawingId).then((doc) => {
      if (cancelled) {
        return
      }
      strokes.current = doc?.strokes ?? []
      setCounts({ strokes: strokes.current.length, undone: 0 })
      resize()
    })
    return () => {
      cancelled = true
    }
  }, [drawingId, resize])

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
    }
  }, [resize])

  /**
   * Should this pointer be drawing at all?
   *
   * Palm rejection: once a pen has been seen, touch is ignored until a moment
   * after the pen lifts. Without it, the hand resting on the screen draws.
   */
  const accepts = (event: React.PointerEvent): boolean => {
    if (event.pointerType === 'touch' && Date.now() - penSeenAt.current < PALM_GRACE) {
      return false
    }
    return true
  }

  const pointAt = (event: React.PointerEvent): StrokePoint => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return {
      x: event.clientX - box.left,
      y: event.clientY - box.top,
      // A mouse reports 0.5 while held and 0 otherwise; a pen reports the real
      // thing. Zero would mean an invisible stroke, so it is treated as a mouse.
      p: event.pressure > 0 ? event.pressure : 0.5
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!accepts(event)) {
      return
    }
    if (event.pointerType === 'pen') {
      penSeenAt.current = Date.now()
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setPointerType(event.pointerType)
    const point = pointAt(event)
    setPressure(point.p)
    active.current = { tool, color: ink, width, points: [point] }
    // A new stroke ends the redo history: you cannot redo into a future that no
    // longer follows from the present.
    undone.current = []
    setCounts({ strokes: strokes.current.length, undone: 0 })
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.pointerType === 'pen') {
      penSeenAt.current = Date.now()
      setPressure(event.pressure)
    }
    const stroke = active.current
    const ctx = context()
    if (stroke === null || ctx === null) {
      return
    }
    const point = pointAt(event)
    setPressure(point.p)
    const previous = stroke.points[stroke.points.length - 1]
    stroke.points.push(point)
    if (TOOL_STYLE[stroke.tool].alpha < 1) {
      // A translucent stroke has to be repainted whole, since it is one path;
      // painting the new segment on top would compound the alpha at the join.
      redraw(true)
      return
    }
    // Otherwise only the new segment is painted, not the whole stroke - the
    // difference between a line that keeps up with the nib and one that does not.
    paintStroke(ctx, { ...stroke, points: [previous, point] })
  }

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.pointerType === 'pen') {
      penSeenAt.current = Date.now()
    }
    const stroke = active.current
    active.current = null
    setPressure(0)
    if (stroke === null) {
      return
    }
    strokes.current = [...strokes.current, stroke]
    setCounts({ strokes: strokes.current.length, undone: undone.current.length })
    redraw()
  }

  const undo = (): void => {
    const last = strokes.current[strokes.current.length - 1]
    if (last === undefined) {
      return
    }
    strokes.current = strokes.current.slice(0, -1)
    undone.current = [...undone.current, last]
    setCounts({ strokes: strokes.current.length, undone: undone.current.length })
    redraw()
  }

  const redo = (): void => {
    const next = undone.current[undone.current.length - 1]
    if (next === undefined) {
      return
    }
    undone.current = undone.current.slice(0, -1)
    strokes.current = [...strokes.current, next]
    setCounts({ strokes: strokes.current.length, undone: undone.current.length })
    redraw()
  }

  /**
   * Store the drawing and hand back its rendered image.
   *
   * Both forms are written: the strokes to their own file so the drawing stays
   * editable, and a PNG to the assets folder so the note can show it without a
   * canvas.
   */
  const done = async (): Promise<void> => {
    const canvas = canvasRef.current
    if (canvas === null) {
      onCancel()
      return
    }
    setBusy(true)
    try {
      const imageUrl = strokes.current.length === 0 ? '' : await window.nib.writeAsset(renderPng())
      const doc: DrawingDoc = {
        id: drawingId,
        width: size.current.width,
        height: size.current.height,
        strokes: strokes.current,
        image: imageUrl
      }
      await window.nib.writeDrawing(doc)
      onDone({ drawingId, imageUrl })
    } finally {
      setBusy(false)
    }
  }

  /** Render the strokes to a cropped PNG data URL, at 2x for a sharp thumbnail. */
  function renderPng(): string {
    const bounds = inkBounds(strokes.current)
    if (bounds === null) {
      return ''
    }
    const scale = 2
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(bounds.width * scale))
    out.height = Math.max(1, Math.round(bounds.height * scale))
    const ctx = out.getContext('2d')
    if (ctx === null) {
      return ''
    }
    ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale)
    for (const stroke of strokes.current) {
      paintStroke(ctx, stroke)
    }
    return out.toDataURL('image/png')
  }

  return (
    <div className="canvas-editor">
      <div className="canvas-tools">
        <div className="toolbar-group">
          {TOOLS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={tool === entry.id ? 'is-active' : ''}
              onClick={() => setTool(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <label className="canvas-width">
          <input
            type="range"
            min={1}
            max={18}
            value={width}
            onChange={(event) => setWidth(Number(event.target.value))}
          />
          <span className="settings-value">{width}</span>
        </label>

        <div className="ink-swatches">
          {INKS.map((colour) => (
            <button
              key={colour}
              type="button"
              className={`ink${ink === colour ? ' is-selected' : ''}`}
              style={{ background: colour }}
              title="Ink"
              onClick={() => setInk(colour)}
            />
          ))}
        </div>

        <span className="pointer-type">{pointerType}</span>
        <span className="pressure-readout">pressure {pressure.toFixed(2)}</span>
        <span className="pressure-meter" title="Pressure">
          <span className="pressure-fill" style={{ height: `${Math.round(pressure * 100)}%` }} />
        </span>

        <div className="toolbar-right">
          <button type="button" disabled={counts.strokes === 0} onClick={undo}>
            Undo
          </button>
          <button type="button" disabled={counts.undone === 0} onClick={redo}>
            Redo
          </button>
          <button type="button" className="is-active" disabled={busy} onClick={() => void done()}>
            Done
          </button>
        </div>
      </div>

      <div className="canvas-surface" ref={surfaceRef}>
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>
    </div>
  )
}
