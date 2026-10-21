import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { chunk } from './chunker'
import { isSafeRelativePath, sha256 } from './install'

/**
 * A release feed is static files, so any static host works (GitHub Pages here):
 *
 *   <feed>/<id>/channel.json          → { id, version, manifest }  (written last)
 *   <feed>/<id>/manifests/<v>.json    → Release
 *   <feed>/<id>/chunks/<ab>/<sha256>  → raw chunk bytes, content-addressed
 *
 * A client only ever needs the latest release's chunks — everything older is
 * already on its disk — so a feed holds one release's chunks at a time.
 */
export type ChunkRef = { hash: string; size: number }
export type ReleaseFile = { path: string; size: number; sha256: string; chunks: ChunkRef[] }
export type Release = { schema: 2; id: string; version: string; builtAt: string; files: ReleaseFile[] }
export type Channel = { id: string; version: string; manifest: string }

export const chunkPath = (hash: string) => `chunks/${hash.slice(0, 2)}/${hash}`

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

/** Chunks every file under `filesDir` into a release and its chunk set. */
export async function buildRelease(
  filesDir: string,
  id: string,
  version: string,
): Promise<{ release: Release; chunks: Map<string, Uint8Array> }> {
  const chunks = new Map<string, Uint8Array>()
  const files: ReleaseFile[] = []
  for (const full of (await walk(filesDir)).sort()) {
    const path = relative(filesDir, full).split(sep).join('/')
    if (path.endsWith('.nojekyll') || !isSafeRelativePath(path)) continue
    const data = await readFile(full)
    const refs = chunk(data).map((c) => {
      const hash = sha256(Buffer.from(c))
      chunks.set(hash, c)
      return { hash, size: c.length }
    })
    files.push({ path, size: data.length, sha256: sha256(data), chunks: refs })
  }
  return { release: { schema: 2, id, version, builtAt: new Date().toISOString(), files }, chunks }
}

/**
 * Writes a release into a feed directory. channel.json is written last and by
 * rename, so a client never sees a channel that points at chunks not yet there.
 */
export async function writeFeed(feedDir: string, release: Release, chunks: Map<string, Uint8Array>): Promise<void> {
  const root = join(feedDir, release.id)
  for (const [hash, data] of chunks) {
    const file = join(root, chunkPath(hash))
    if (await stat(file).catch(() => null)) continue   // content-addressed: same hash, same bytes
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, data)
  }
  const manifest = `manifests/${release.version}.json`
  await mkdir(join(root, 'manifests'), { recursive: true })
  await writeFile(join(root, manifest), JSON.stringify(release) + '\n')
  const channel: Channel = { id: release.id, version: release.version, manifest }
  await writeFile(join(root, 'channel.json.tmp'), JSON.stringify(channel) + '\n')
  await rename(join(root, 'channel.json.tmp'), join(root, 'channel.json'))
}

/** Checks a release fetched from the network before anything trusts it. */
export function validateRelease(r: unknown, id: string): Release {
  const rel = r as Release
  const hex = /^[0-9a-f]{64}$/
  if (!rel || rel.schema !== 2 || rel.id !== id || typeof rel.version !== 'string' || !Array.isArray(rel.files)) {
    throw new Error('Malformed release manifest')
  }
  for (const f of rel.files) {
    if (!isSafeRelativePath(f.path) || !hex.test(f.sha256) || !Array.isArray(f.chunks)) {
      throw new Error(`Malformed release entry: ${String(f.path)}`)
    }
    let total = 0
    for (const c of f.chunks) {
      if (!hex.test(c.hash) || !Number.isInteger(c.size) || c.size < 0) throw new Error(`Malformed chunk in ${f.path}`)
      total += c.size
    }
    if (total !== f.size) throw new Error(`Chunks of ${f.path} don't add up to its size`)
  }
  if (!/^[\w.-]+$/.test(rel.version)) throw new Error('Unsafe release version')
  return rel
}
