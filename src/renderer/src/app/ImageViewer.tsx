import { useCallback, useEffect, useRef, useState } from 'react'
import { assetName, stepIndex } from '../lib/lightbox'

/**
 * The viewer for a picture in a note: an overlay, scaled to fit, opened from the
 * editor on a double-click or from the image toolbar.
 *
 * Hand-built for the reasons ConfirmModal is - a native window would be a light
 * box beside a dark app, and a second OS window is somewhere to lose the note.
 *
 * The picture is shown at 100% when the window holds it and shrunk to fit when it
 * does not (CSS max-size does exactly that and never enlarges). A click on the
 * picture toggles actual size, where the stage scrolls and a drag pans it. A file
 * that is not there shows a plain "missing" state instead of an empty overlay.
 * Rejected: a zoom control with steps - the question is only ever "can I read
 * it", and fit and actual size answer it.
 */

interface ImageViewerProps {
  sources: string[]
  start: number
  onClose: () => void
}

export function ImageViewer({ sources, start, onClose }: ImageViewerProps): React.JSX.Element {
  const [index, setIndex] = useState(start)
  const [actual, setActual] = useState(false)
  const [missing, setMissing] = useState(false)
  const [canZoom, setCanZoom] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(
    null
  )

  const src = sources[index] ?? ''

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => stepIndex(current, sources.length, delta))
      setActual(false)
      setMissing(false)
    },
    [sources.length]
  )

  /** Whether fit mode is hiding pixels: only then is there anything to zoom into. */
  const measure = useCallback(() => {
    const image = imageRef.current
    if (image === null) {
      return
    }
    if (actual) {
      setCanZoom(true)
      return
    }
    setCanZoom(
      image.naturalWidth > image.clientWidth + 1 || image.naturalHeight > image.clientHeight + 1
    )
  }, [actual])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure, src])

  // Keys are taken in the capture phase and stopped, so that Escape closes the
  // viewer and does not also clear the editor's selection underneath it.
  useEffect(() => {
    stageRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        event.stopPropagation()
        go(event.key === 'ArrowRight' ? 1 : -1)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [go, onClose])

  const toggle = (): void => {
    if (drag.current?.moved === true) {
      return
    }
    if (actual || canZoom) {
      setActual((current) => !current)
    }
  }

  return (
    <div className="viewer-overlay" role="dialog" aria-modal="true" aria-label="Image viewer">
      <div
        ref={stageRef}
        tabIndex={-1}
        className={`viewer-stage${actual ? ' is-actual' : ''}`}
        onClick={(event) => {
          // The backdrop is the stage itself; the picture and the controls are not.
          if (event.target === event.currentTarget) {
            onClose()
          }
        }}
        onMouseDown={(event) => {
          const stage = stageRef.current
          if (stage === null || !actual) {
            return
          }
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: stage.scrollLeft,
            top: stage.scrollTop,
            moved: false
          }
        }}
        onMouseMove={(event) => {
          const stage = stageRef.current
          const origin = drag.current
          if (stage === null || origin === null || event.buttons !== 1) {
            return
          }
          const dx = event.clientX - origin.x
          const dy = event.clientY - origin.y
          if (Math.abs(dx) + Math.abs(dy) > 3) {
            origin.moved = true
          }
          stage.scrollLeft = origin.left - dx
          stage.scrollTop = origin.top - dy
        }}
        onMouseUp={() => {
          // Left set for the click that follows, which reads it and ignores a pan.
          window.setTimeout(() => {
            drag.current = null
          }, 0)
        }}
      >
        {missing ? (
          <div className="viewer-missing" onClick={(event) => event.stopPropagation()}>
            <strong>Image file missing</strong>
            <span>{assetName(src)}</span>
            <span className="viewer-missing-hint">
              The note still points at it, but the file is not in the assets folder.
            </span>
          </div>
        ) : (
          <img
            ref={imageRef}
            key={src}
            className={canZoom || actual ? 'is-zoomable' : ''}
            src={src}
            alt=""
            draggable={false}
            onLoad={measure}
            onError={() => setMissing(true)}
            onClick={toggle}
          />
        )}
      </div>

      <button
        type="button"
        className="viewer-close"
        aria-label="Close"
        title="Close (Esc)"
        onClick={onClose}
      >
        ×
      </button>
      {sources.length > 1 && (
        <>
          <button
            type="button"
            className="viewer-step is-prev"
            aria-label="Previous image"
            onClick={() => go(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="viewer-step is-next"
            aria-label="Next image"
            onClick={() => go(1)}
          >
            ›
          </button>
          <div className="viewer-count">
            {index + 1} / {sources.length}
          </div>
        </>
      )}
    </div>
  )
}
