/**
 * The arithmetic and the lookup behind the image viewer, apart from the React
 * that draws it so they can be tested without a window.
 *
 * What it is for: a screenshot pasted into a note renders at reading size, which
 * is too small to read the thing it was pasted to show. The viewer opens it large;
 * this file decides how large and which picture comes next.
 *
 * The rule worth keeping in one place is "never upscale": a picture that fits the
 * window is shown at 100%, not stretched to fill it. A small screenshot blown up
 * to the window is a blur, which is the exact thing the viewer exists to avoid,
 * and the same reasoning stops a pasted image being upscaled on insert.
 *
 * Rejected: a viewer that always fits the window. It looks tidier and makes a
 * 400px crop of a spreadsheet unreadable for no gain.
 */

/** A width and a height, in CSS pixels. */
export interface Size {
  width: number
  height: number
}

/**
 * The scale at which a picture is shown to fit an area: 1 when it already fits,
 * smaller when it does not, never more than 1. A picture with no size yet, or an
 * area with none, is shown at 1 - the viewer has nothing better to say.
 */
export function fitScale(natural: Size, area: Size): number {
  if (natural.width <= 0 || natural.height <= 0 || area.width <= 0 || area.height <= 0) {
    return 1
  }
  return Math.min(1, area.width / natural.width, area.height / natural.height)
}

/**
 * Where the arrow keys go from here, wrapping at both ends. With one picture, or
 * none, there is nowhere to go and the index stays put.
 */
export function stepIndex(index: number, count: number, delta: number): number {
  if (count <= 1) {
    return index
  }
  return (((index + delta) % count) + count) % count
}

/** The file name at the end of an asset URL, for saying which one is missing. */
export function assetName(src: string): string {
  const last = src.split('/').pop() ?? ''
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

/**
 * The pictures a note holds, in reading order, and the position of the one that
 * was opened.
 *
 * A drawing block carries a rendered image of its own, but clicking one opens the
 * drawing - it is not a picture in the note, so it is neither a candidate nor a
 * step on the way. An image with no `src` has nothing to show.
 */
export function collectImages(
  root: ParentNode,
  opened: Element
): { sources: string[]; index: number } {
  const sources: string[] = []
  let index = 0
  for (const image of Array.from(root.querySelectorAll('img'))) {
    const src = image.getAttribute('src') ?? ''
    if (src.length === 0 || image.closest('[data-canvas]') !== null) {
      continue
    }
    if (image === opened) {
      index = sources.length
    }
    sources.push(src)
  }
  return { sources, index }
}
