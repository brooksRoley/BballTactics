/**
 * Content-defined chunking with a gear rolling hash (the core of FastCDC).
 *
 * A boundary falls where the hash of the bytes just read matches a bit mask,
 * so boundaries follow content, not offsets: inserting bytes near the start of
 * a file moves only the chunk it lands in, and every later chunk keeps its
 * bytes — and its hash — so an update re-downloads only what changed.
 * Fixed-size chunks would shift every chunk after the edit.
 */

export type ChunkOptions = { min: number; avg: number; max: number }

/**
 * Average ~16 KiB: a 1 MB game is ~60 chunks, so an edit costs a few KB.
 * `max` is a forced cut at a fixed offset, which an insertion shifts — so it
 * cascades into the next chunk. At 8× avg a forced cut happens for ~0.04% of
 * chunks (e^-(max-min)/avg); at 4× it was ~2%, enough to turn a one-line
 * change into a 160 KB download on unlucky data.
 */
export const DEFAULT_CHUNKING: ChunkOptions = { min: 4 * 1024, avg: 16 * 1024, max: 128 * 1024 }

/** 256 pseudo-random 32-bit values from a fixed seed, so releases and clients agree. */
const GEAR = (() => {
  const table = new Uint32Array(256)
  let s = 0x9e3779b9
  for (let i = 0; i < 256; i++) {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    table[i] = (t ^ (t >>> 14)) >>> 0
  }
  return table
})()

/** End offsets (exclusive) of each chunk in `data`. Always covers the whole input. */
export function chunkBoundaries(data: Uint8Array, opts: ChunkOptions = DEFAULT_CHUNKING): number[] {
  const { min, avg, max } = opts
  if (avg & (avg - 1)) throw new Error('avg must be a power of two')
  const mask = avg - 1
  const ends: number[] = []
  let start = 0
  while (start < data.length) {
    const limit = Math.min(start + max, data.length)
    let end = limit
    let h = 0
    for (let i = start; i < limit; i++) {
      h = ((h << 1) + GEAR[data[i]!]!) >>> 0
      if (i + 1 - start >= min && (h & mask) === 0) {
        end = i + 1
        break
      }
    }
    ends.push(end)
    start = end
  }
  return ends
}

/** Splits `data` into its chunks (views, not copies). */
export function chunk(data: Uint8Array, opts: ChunkOptions = DEFAULT_CHUNKING): Uint8Array[] {
  const out: Uint8Array[] = []
  let start = 0
  for (const end of chunkBoundaries(data, opts)) {
    out.push(data.subarray(start, end))
    start = end
  }
  return out
}
