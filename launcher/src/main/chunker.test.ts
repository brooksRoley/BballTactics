import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { chunk, chunkBoundaries, DEFAULT_CHUNKING } from './chunker'
import { sha256 } from './install'

const hashes = (data: Uint8Array) => chunk(data).map((c) => sha256(Buffer.from(c)))

describe('chunkBoundaries', () => {
  it('covers the input exactly, within the size limits', () => {
    const data = randomBytes(600 * 1024)
    const ends = chunkBoundaries(data)
    expect(ends.at(-1)).toBe(data.length)
    let start = 0
    for (const [i, end] of ends.entries()) {
      const size = end - start
      expect(size).toBeLessThanOrEqual(DEFAULT_CHUNKING.max)
      if (i < ends.length - 1) expect(size).toBeGreaterThanOrEqual(DEFAULT_CHUNKING.min)
      start = end
    }
  })

  it('is deterministic', () => {
    const data = randomBytes(200 * 1024)
    expect(chunkBoundaries(data)).toEqual(chunkBoundaries(Buffer.from(data)))
  })

  it('treats empty and tiny inputs as at most one chunk', () => {
    expect(chunkBoundaries(new Uint8Array(0))).toEqual([])
    expect(chunkBoundaries(new Uint8Array(10))).toEqual([10])
  })

  it('keeps most chunks when bytes are inserted near the start', () => {
    const before = randomBytes(800 * 1024)
    const after = Buffer.concat([before.subarray(0, 1000), Buffer.from('/* one-line change */'), before.subarray(1000)])
    const old = new Set(hashes(before))
    const next = hashes(after)
    const reused = next.filter((h) => old.has(h)).length
    // Fixed-size chunks would reuse ~none after an insertion; content-defined keeps all but ~1–2.
    expect(next.length - reused).toBeLessThanOrEqual(2)
  })
})
