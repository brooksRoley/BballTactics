import { createHash } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** A release or manifest path may only name a file inside the install directory. */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.startsWith('/') || p.includes('\\') || /^[a-zA-Z]:/.test(p)) return false
  return p.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Writes JSON by temp file + rename, so a crash never leaves it half-written. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n')
  await rename(tmp, file)
}
