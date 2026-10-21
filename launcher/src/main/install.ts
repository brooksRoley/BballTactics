import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** One file in a build, as the staging script (and M2's release) records it. */
export type ManifestFile = { path: string; size: number; sha256: string }

export type Manifest = { id: string; version: string; builtAt: string; files: ManifestFile[] }

export type InstallProgress = {
  phase: 'copying' | 'done'
  done: number
  total: number
}

/** Reads and sanity-checks a manifest; throws with the reason if it's unusable. */
export async function readManifest(file: string): Promise<Manifest> {
  const m = JSON.parse(await readFile(file, 'utf8')) as Manifest
  if (typeof m.id !== 'string' || typeof m.version !== 'string' || !Array.isArray(m.files)) {
    throw new Error(`Malformed manifest: ${file}`)
  }
  for (const f of m.files) {
    if (!isSafeRelativePath(f.path)) throw new Error(`Unsafe path in manifest: ${f.path}`)
  }
  return m
}

/** A manifest path may only name a file inside the install directory. */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\\') || /^[a-zA-Z]:/.test(p)) return false
  return p.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Copies every manifest file from `sourceDir` into `targetDir`, verifying each
 * file's SHA-256 before writing it. Work happens in a sibling `.partial`
 * directory that is renamed into place only when every file has verified, so
 * a failed or interrupted install never leaves a half-written game where a
 * playable one is expected.
 */
export async function installVerified(
  manifest: Manifest,
  sourceDir: string,
  targetDir: string,
  onProgress: (p: InstallProgress) => void = () => {},
): Promise<void> {
  const partial = `${targetDir}.partial`
  await rm(partial, { recursive: true, force: true })
  const total = manifest.files.length
  try {
    for (const [i, f] of manifest.files.entries()) {
      const data = await readFile(join(sourceDir, f.path))
      if (data.length !== f.size || sha256(data) !== f.sha256) {
        throw new Error(`Verification failed for ${f.path}`)
      }
      const dest = join(partial, f.path)
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, data)
      onProgress({ phase: 'copying', done: i + 1, total })
    }
    await rm(targetDir, { recursive: true, force: true })
    await rename(partial, targetDir)
  } catch (e) {
    await rm(partial, { recursive: true, force: true })
    throw e
  }
  onProgress({ phase: 'done', done: total, total })
}

/** Writes JSON by temp file + rename, so a crash never leaves it half-written. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n')
  await rename(tmp, file)
}
