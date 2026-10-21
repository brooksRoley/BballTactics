import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { sha256 } from './install'
import { chunkPath, validateRelease, type Channel, type Release } from './release'

/** Reads a release feed over HTTP (any static host). */
export class Feed {
  private readonly base: string

  constructor(base: string, private readonly fetchImpl: typeof fetch = fetch) {
    this.base = base.endsWith('/') ? base : `${base}/`
  }

  private async get(id: string, path: string, signal?: AbortSignal): Promise<Response> {
    const res = await this.fetchImpl(new URL(`${id}/${path}`, this.base), { signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
    return res
  }

  async channel(id: string, signal?: AbortSignal): Promise<Channel> {
    const c = (await (await this.get(id, 'channel.json', signal)).json()) as Channel
    if (c.id !== id || typeof c.manifest !== 'string' || !/^manifests\/[\w.-]+\.json$/.test(c.manifest)) {
      throw new Error('Malformed channel')
    }
    return c
  }

  async release(id: string, channel: Channel, signal?: AbortSignal): Promise<Release> {
    return validateRelease(await (await this.get(id, channel.manifest, signal)).json(), id)
  }

  async chunk(id: string, hash: string, signal?: AbortSignal): Promise<Uint8Array> {
    return new Uint8Array(await (await this.get(id, chunkPath(hash), signal)).arrayBuffer())
  }
}

export type UpdatePhase = 'checking' | 'downloading' | 'assembling' | 'done'

export type UpdateProgress = {
  phase: UpdatePhase
  /** Network bytes needed for this release, and how many are already on disk. */
  bytesTotal: number
  bytesDone: number
  /** Bytes taken from the installed version instead of the network. */
  reusedBytes: number
  releaseBytes: number
}

export type UpdateResult = { version: string; downloadedBytes: number; reusedBytes: number; releaseBytes: number }

/**
 * Game directory layout:
 *   versions/<v>/…        installed files, served by game://
 *   manifests/<v>.json    the release each version was built from (for reuse)
 *   chunks/<hash>         verified downloads not yet assembled (resume cache)
 */
const versionDir = (gameDir: string, v: string) => join(gameDir, 'versions', v)
const manifestFile = (gameDir: string, v: string) => join(gameDir, 'manifests', `${v}.json`)
const cacheFile = (gameDir: string, hash: string) => join(gameDir, 'chunks', hash)

type LocalChunk = { file: string; offset: number; size: number }

/** Where each chunk of every installed version lives on disk. */
async function indexInstalled(gameDir: string, id: string): Promise<Map<string, LocalChunk>> {
  const index = new Map<string, LocalChunk>()
  const versions = await readdir(join(gameDir, 'versions')).catch(() => [] as string[])
  for (const v of versions) {
    if (v.endsWith('.partial')) continue
    let rel: Release
    try {
      rel = validateRelease(JSON.parse(await readFile(manifestFile(gameDir, v), 'utf8')), id)
    } catch {
      continue   // no manifest, no reuse; the version still plays
    }
    for (const f of rel.files) {
      let offset = 0
      for (const c of f.chunks) {
        if (!index.has(c.hash)) index.set(c.hash, { file: join(versionDir(gameDir, v), f.path), offset, size: c.size })
        offset += c.size
      }
    }
  }
  return index
}

async function readRange(file: string, offset: number, size: number): Promise<Uint8Array | null> {
  const fh = await open(file, 'r').catch(() => null)
  if (!fh) return null
  try {
    const buf = Buffer.alloc(size)
    const { bytesRead } = await fh.read(buf, 0, size, offset)
    return bytesRead === size ? buf : null
  } finally {
    await fh.close()
  }
}

const verified = (data: Uint8Array | null, hash: string, size: number) =>
  !!data && data.length === size && sha256(Buffer.from(data)) === hash

/** A chunk from the installed files or the resume cache, verified; else null. */
async function readLocal(gameDir: string, index: Map<string, LocalChunk>, hash: string, size: number) {
  const at = index.get(hash)
  if (at) {
    const data = await readRange(at.file, at.offset, size)
    if (verified(data, hash, size)) return { data: data!, source: 'installed' as const }
  }
  const cached = await readFile(cacheFile(gameDir, hash)).catch(() => null)
  if (verified(cached, hash, size)) return { data: cached!, source: 'cache' as const }
  return null
}

async function fetchVerified(feed: Feed, id: string, hash: string, size: number, signal?: AbortSignal): Promise<Uint8Array> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted()
    try {
      const data = await feed.chunk(id, hash, signal)
      if (verified(data, hash, size)) return data
      last = new Error(`Chunk ${hash.slice(0, 12)} failed verification`)
    } catch (e) {
      if (signal?.aborted) throw e
      last = e
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

/**
 * Installs `release` into `gameDir`, downloading only chunks that aren't
 * already on disk — in an installed version or the resume cache — four at a
 * time, each verified by hash (a bad chunk is refetched, up to three tries).
 * Files are assembled into versions/<v>.partial, verified whole, then renamed
 * into place, so the version being played is never touched. An abort or a
 * failure keeps every verified chunk in the cache: the next attempt resumes.
 */
export async function installRelease(opts: {
  feed: Feed
  release: Release
  gameDir: string
  onProgress?: (p: UpdateProgress) => void
  signal?: AbortSignal
  concurrency?: number
}): Promise<UpdateResult> {
  const { feed, release, gameDir, signal, onProgress = () => {}, concurrency = 4 } = opts
  const id = release.id

  const sizes = new Map<string, number>()
  for (const f of release.files) for (const c of f.chunks) sizes.set(c.hash, c.size)
  const releaseBytes = [...sizes.values()].reduce((a, b) => a + b, 0)

  const progress: UpdateProgress = { phase: 'checking', bytesTotal: 0, bytesDone: 0, reusedBytes: 0, releaseBytes }
  onProgress({ ...progress })
  const index = await indexInstalled(gameDir, id)

  const missing: string[] = []
  for (const [hash, size] of sizes) {
    signal?.throwIfAborted()
    const local = await readLocal(gameDir, index, hash, size)
    if (local?.source === 'installed') progress.reusedBytes += size
    else {
      progress.bytesTotal += size
      if (local) progress.bytesDone += size   // verified in the cache from an earlier attempt
      else missing.push(hash)
    }
  }

  progress.phase = 'downloading'
  onProgress({ ...progress })
  let downloadedBytes = 0
  const queue = [...missing]
  await mkdir(join(gameDir, 'chunks'), { recursive: true })
  const worker = async () => {
    for (let hash = queue.shift(); hash; hash = queue.shift()) {
      const size = sizes.get(hash)!
      const data = await fetchVerified(feed, id, hash, size, signal)
      const tmp = `${cacheFile(gameDir, hash)}.tmp`
      await writeFile(tmp, data)
      await rename(tmp, cacheFile(gameDir, hash))
      downloadedBytes += size
      progress.bytesDone += size
      onProgress({ ...progress })
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))

  progress.phase = 'assembling'
  onProgress({ ...progress })
  const target = versionDir(gameDir, release.version)
  const partial = `${target}.partial`
  await rm(partial, { recursive: true, force: true })
  try {
    for (const f of release.files) {
      signal?.throwIfAborted()
      const parts: Uint8Array[] = []
      for (const c of f.chunks) {
        const local = await readLocal(gameDir, index, c.hash, c.size)
        if (!local) throw new Error(`Chunk ${c.hash.slice(0, 12)} for ${f.path} went missing`)
        parts.push(local.data)
      }
      const data = Buffer.concat(parts)
      if (data.length !== f.size || sha256(data) !== f.sha256) throw new Error(`Verification failed for ${f.path}`)
      const dest = join(partial, f.path)
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, data)
    }
    await rm(target, { recursive: true, force: true })
    await rename(partial, target)
  } catch (e) {
    await rm(partial, { recursive: true, force: true })
    throw e
  }
  await mkdir(join(gameDir, 'manifests'), { recursive: true })
  await writeFile(manifestFile(gameDir, release.version), JSON.stringify(release))
  progress.phase = 'done'
  onProgress({ ...progress })
  return { version: release.version, downloadedBytes, reusedBytes: progress.reusedBytes, releaseBytes }
}

/** Removes every version except `keep`, their manifests, and the resume cache. */
export async function prune(gameDir: string, keep: string[]): Promise<void> {
  for (const v of await readdir(join(gameDir, 'versions')).catch(() => [] as string[])) {
    if (!keep.includes(v)) await rm(versionDir(gameDir, v), { recursive: true, force: true })
  }
  for (const m of await readdir(join(gameDir, 'manifests')).catch(() => [] as string[])) {
    if (!keep.includes(m.replace(/\.json$/, ''))) await rm(join(gameDir, 'manifests', m), { force: true })
  }
  await rm(join(gameDir, 'chunks'), { recursive: true, force: true })
}

export { versionDir }
export const hasVersion = async (gameDir: string, v: string) =>
  !!(await stat(versionDir(gameDir, v)).catch(() => null))
