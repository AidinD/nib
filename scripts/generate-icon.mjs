import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

/*
 * Minimal dependency-free PNG writer, the same approach Jot uses for its icon.
 *
 * Renders Nib's app icon: a rounded square in the app background, holding a pen
 * nib - a tapered shape with a slit down the middle and a vent hole, which is
 * what a nib actually looks like and what the app is named after.
 *
 * Run with `node scripts/generate-icon.mjs`. Committed output lives in
 * resources/, because electron-builder needs it at package time and a build
 * should not depend on having run a script first.
 */

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources')
mkdirSync(outDir, { recursive: true })

const BG = [27, 28, 31, 255] // --bg
const INK = [111, 156, 255, 255] // --accent
const HOLE = [27, 28, 31, 255]

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i]
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1)
      crc = (crc >>> 1) ^ (0xedb88320 & mask)
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

/** Is (x, y) inside a rounded square inset by `inset` with corner `radius`? */
function inRoundedSquare(x, y, size, inset, radius) {
  const min = inset
  const max = size - inset
  if (x < min || y < min || x > max || y > max) {
    return false
  }
  const dx = Math.max(min + radius - x, 0, x - (max - radius))
  const dy = Math.max(min + radius - y, 0, y - (max - radius))
  return dx * dx + dy * dy <= radius * radius
}

/**
 * The nib: a shape that is straight-sided at the top and tapers to a point.
 *
 * Built as a half-width function of height rather than as a polygon, so the
 * taper is a curve and the point is genuinely sharp at any icon size.
 */
function inNib(x, y, size) {
  const top = size * 0.2
  const tip = size * 0.84
  if (y < top || y > tip) {
    return false
  }
  const centre = size / 2
  const t = (y - top) / (tip - top)
  // Full width for the first stretch, then easing in to the point.
  const halfWidth = size * 0.19 * (1 - Math.pow(t, 1.7))
  return Math.abs(x - centre) <= halfWidth
}

/** The slit and the vent hole, both cut out of the nib. */
function inCutout(x, y, size) {
  const centre = size / 2
  const slitTop = size * 0.46
  const slitBottom = size * 0.8
  const slitHalf = Math.max(size * 0.012, 1)
  if (y >= slitTop && y <= slitBottom && Math.abs(x - centre) <= slitHalf) {
    return true
  }
  const holeY = size * 0.42
  const holeR = size * 0.055
  const dx = x - centre
  const dy = y - holeY
  return dx * dx + dy * dy <= holeR * holeR
}

function renderPng(size) {
  const inset = Math.round(size * 0.06)
  const radius = Math.round(size * 0.2)
  const rows = []

  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4)
    row[0] = 0 // no filter
    for (let x = 0; x < size; x += 1) {
      let colour = [0, 0, 0, 0]
      if (inRoundedSquare(x, y, size, inset, radius)) {
        colour = BG
        if (inNib(x, y, size)) {
          colour = inCutout(x, y, size) ? HOLE : INK
        }
      }
      row.set(colour, 1 + x * 4)
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

// 512px for the installer and the app icon; 32px for the small contexts Windows
// scales badly on its own.
writeFileSync(join(outDir, 'icon.png'), renderPng(512))
writeFileSync(join(outDir, 'icon-32.png'), renderPng(32))
console.log('Wrote resources/icon.png (512) and resources/icon-32.png')
