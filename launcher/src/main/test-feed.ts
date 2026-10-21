// Test-only helpers: a scriptable feed server and small seeded "games".
// Not imported by app code, so it never ships.
import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { buildRelease, writeFeed, type Release } from './release'
import { Feed } from './updater'

/** A feed server whose misbehavior each test can script. */
export type Faults = { failAfterChunks?: number; corrupt?: Map<string, number> }
const servers: Server[] = []
afterEach(() => servers.splice(0).forEach((s) => s.close()))

export async function serveFeed(feedDir: string, faults: Faults = {}) {
  const stats = { chunkRequests: 0, chunkBytes: 0, byHash: new Map<string, number>() }
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url!, 'http://x').pathname)
    const isChunk = path.includes('/chunks/')
    if (isChunk) {
      if (faults.failAfterChunks !== undefined && stats.chunkRequests >= faults.failAfterChunks) {
        res.destroy()   // the network drops mid-update
        return
      }
      stats.chunkRequests++
    }
    try {
      let body = await readFile(join(feedDir, path))
      const hash = path.split('/').pop()!
      if (isChunk) {
        stats.byHash.set(hash, (stats.byHash.get(hash) ?? 0) + 1)
        const left = faults.corrupt?.get(hash) ?? 0
        if (left > 0) {
          faults.corrupt!.set(hash, left - 1)
          body = Buffer.from(body.map((b) => b ^ 0xff))
        }
        stats.chunkBytes += body.length
      }
      res.end(body)
    } catch {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  return { feed: new Feed(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`), stats }
}

/** A ~700 KB "game": a big pseudo-random bundle plus a small page. */
export async function makeGame(dir: string, bundle: Buffer, html = '<h1>Hardwood</h1>') {
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'assets/app.js'), bundle)
  await writeFile(join(dir, 'index.html'), html)
}

export async function release(version: string, bundle: Buffer, feedDir: string, html?: string): Promise<Release> {
  const files = await mkdtemp(join(tmpdir(), 'hw-files-'))
  await makeGame(files, bundle, html)
  const { release: rel, chunks } = await buildRelease(files, 'hardwood', version)
  await writeFeed(feedDir, rel, chunks)
  return rel
}

export const tmp = () => mkdtemp(join(tmpdir(), 'hw-upd-'))

/** Seeded bytes, so chunk boundaries — and these tests — are the same every run. */
export function randomBytes(n: number, seed = n): Buffer {
  const out = Buffer.alloc(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    out[i] = s >>> 24
  }
  return out
}
