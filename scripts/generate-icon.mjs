import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import {
  renderPng,
  renderIco,
  coverage,
  distPolygon,
  distRing,
  distSegment,
  mix,
  SMALL_BELOW
} from 'keel/icon'

/*
 * Nib's app icon.
 *
 * The family it belongs to: Jot is a circle-and-tick in an orange-to-coral
 * gradient, Helm a ship's wheel in terracotta. Both are a single object on a
 * transparent background, built from thick strokes with round caps, in a warm
 * colour - no container, no square. So this is a pen nib, in brass, the same way.
 *
 * ONE mark at every size. An earlier version drew a second, simpler mark for 16
 * and 32 - and Windows duly showed one logo in the taskbar and a different one
 * in search, which reads as two logos and is worse than the blur it avoided.
 *
 * What changes with size instead is detail and weight: below 32px the vent hole
 * is dropped and the stroke thickens, because a 1px ring is a smudge. Same
 * silhouette, same slit, same colour - recognisably the same mark.
 *
 * The PNG writer, the ICO writer and the distance-field helpers now come from
 * `keel/icon`, shared with the rest of the suite. This file is Nib's geometry and
 * Nib's colour, which is all it ever should have been - the 120 lines above them
 * existed in four repos.
 *
 * Run with `node scripts/generate-icon.mjs`. The output is committed, because
 * packaging must not depend on having run a script first.
 */

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })

/** The outline of a nib: straight-shouldered, easing to a point. */
function nibOutline(cx, top, tip, halfWidth, power = 1.75, steps = 48) {
  const left = []
  const right = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const y = mix(top, tip, t)
    const hw = halfWidth * (1 - Math.pow(t, power))
    left.push([cx - hw, y])
    right.push([cx + hw, y])
  }
  const path = [...left, ...right.reverse()]
  return path.filter(
    (point, i) => i === 0 || Math.hypot(point[0] - path[i - 1][0], point[1] - path[i - 1][1]) > 1e-6
  )
}

/**
 * Brass, warmed across the diagonal the way Jot's icon is.
 *
 * Kept here rather than taken from keel's `diagonalRamp`, which weights the
 * diagonal evenly. This leans 0.55/0.45 towards x, which is a small thing and
 * visible: it is what puts the warm end on the shoulder rather than the tip.
 * Colour is the app's identity anyway - keel supplies the drawing, not the look.
 */
function brass(x, y, size) {
  const t = Math.max(0, Math.min(1, (x / size) * 0.55 + (y / size) * 0.45))
  return [Math.round(mix(232, 201, t)), Math.round(mix(181, 126, t)), Math.round(mix(92, 62, t))]
}

/**
 * The nib. The only mark there is.
 *
 * Small sizes get a heavier stroke and no vent hole - at 16px a ring of one
 * pixel is a smudge, and the slit alone still says "nib". Everything else is
 * identical, so the taskbar and the Start menu show the same logo.
 */
function shadeNib(x, y, size) {
  const small = size < SMALL_BELOW
  const weight = size * (small ? 0.1 : size < 64 ? 0.075 : 0.055)
  const cx = size / 2
  const outline = nibOutline(cx, size * 0.13, size * 0.9, size * 0.245)
  const holeR = size * 0.075
  const holeY = size * 0.44

  const parts = [distPolygon(x, y, outline)]
  if (small) {
    // Just the slit, running most of the body.
    parts.push(distSegment(x, y, cx, size * 0.38, cx, size * 0.8))
  } else {
    parts.push(distSegment(x, y, cx, holeY + holeR, cx, size * 0.855))
    parts.push(distRing(x, y, cx, holeY, holeR))
  }

  const alpha = coverage(Math.min(...parts), weight / 2)
  if (alpha === 0) {
    return [0, 0, 0, 0]
  }
  const [r, g, b] = brass(x, y, size)
  return [r, g, b, Math.round(255 * alpha)]
}

// The PNG electron-builder falls back to, and the source of truth for the mark.
writeFileSync(join(outDir, 'icon.png'), renderPng(512, shadeNib))

// keel's DEFAULT_LADDER already carries 20 and 24 alongside the usual sizes,
// because Windows asks for them at 125% and 150% display scaling - the two
// scales where a missing frame means it resamples a neighbour and the mark goes
// soft again.
writeFileSync(join(outDir, 'icon.ico'), renderIco(shadeNib))

console.log('Wrote resources/icon.png and resources/icon.ico')
