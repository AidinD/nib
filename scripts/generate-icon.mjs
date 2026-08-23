import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

/*
 * Nib's app icon, drawn without dependencies.
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
 * They go into a multi-size icon.ico so each size is drawn rather than
 * downscaled from the 256.
 *
 * Run with `node scripts/generate-icon.mjs`. The output is committed, because
 * packaging must not depend on having run a script first.
 */

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })

// ---------- PNG ----------

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function renderPng(size, shade) {
  const rows = []
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x += 1) {
      row.set(shade(x + 0.5, y + 0.5, size), 1 + x * 4)
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * A Vista-era .ico: a directory of entries, each holding a whole PNG.
 *
 * Written by hand so the small sizes can be a different drawing. Handing
 * electron-builder a single large PNG would have it downscale that one drawing
 * to 16px, which is exactly what the second drawing exists to avoid.
 */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const directory = []
  let offset = 6 + images.length * 16
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size // 0 means 256
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0 // palette
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    directory.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...directory, ...images.map((image) => image.png)])
}

// ---------- distance fields ----------

const mix = (a, b, t) => a + (b - a) * t

/**
 * Distance from a point to a segment.
 *
 * The zero-length guard matters: a nib outline's two sides meet at the tip, so
 * its closed path contains a segment of length zero, and dividing by it turns
 * every distance into NaN - which paints black, not nothing.
 */
function distSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const lengthSquared = abx * abx + aby * aby
  if (lengthSquared === 0) {
    return Math.hypot(px - ax, py - ay)
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSquared))
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t))
}

function distPath(px, py, points, closed = false) {
  let best = Infinity
  const last = closed ? points.length : points.length - 1
  for (let i = 0; i < last; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    best = Math.min(best, distSegment(px, py, a[0], a[1], b[0], b[1]))
  }
  return best
}

const distRing = (px, py, cx, cy, r) => Math.abs(Math.hypot(px - cx, py - cy) - r)

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

/** Anti-aliasing: coverage falls off across about a pixel of distance. */
function coverage(distance, halfWeight, feather = 1.1) {
  return Math.max(0, Math.min(1, (halfWeight - distance) / feather + 0.5))
}

/** Brass, warmed across the diagonal the way Jot's icon is. */
function brass(x, y, size) {
  const t = Math.max(0, Math.min(1, (x / size) * 0.55 + (y / size) * 0.45))
  return [
    Math.round(mix(232, 201, t)),
    Math.round(mix(181, 126, t)),
    Math.round(mix(92, 62, t))
  ]
}

// ---------- the two drawings ----------

/**
 * The nib. The only mark there is.
 *
 * Small sizes get a heavier stroke and no vent hole - at 16px a ring of one
 * pixel is a smudge, and the slit alone still says "nib". Everything else is
 * identical, so the taskbar and the Start menu show the same logo.
 */
function shadeNib(x, y, size) {
  const small = size < 32
  const weight = size * (small ? 0.1 : size < 64 ? 0.075 : 0.055)
  const cx = size / 2
  const outline = nibOutline(cx, size * 0.13, size * 0.9, size * 0.245)
  const holeR = size * 0.075
  const holeY = size * 0.44

  const parts = [distPath(x, y, outline, true)]
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

// ---------- output ----------

// The PNG electron-builder falls back to, and the source of truth for the mark.
writeFileSync(join(outDir, 'icon.png'), renderPng(512, shadeNib))

writeFileSync(
  join(outDir, 'icon.ico'),
  buildIco([
    { size: 256, png: renderPng(256, shadeNib) },
    { size: 128, png: renderPng(128, shadeNib) },
    { size: 64, png: renderPng(64, shadeNib) },
    { size: 48, png: renderPng(48, shadeNib) },
    { size: 32, png: renderPng(32, shadeNib) },
    { size: 16, png: renderPng(16, shadeNib) }
  ])
)

console.log('Wrote resources/icon.png and resources/icon.ico')
