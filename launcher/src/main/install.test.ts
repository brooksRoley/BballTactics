import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installVerified, isSafeRelativePath, sha256, type Manifest } from './install'

async function fixture(files: Record<string, string>): Promise<{ src: string; manifest: Manifest }> {
  const src = await mkdtemp(join(tmpdir(), 'hw-src-'))
  const entries = []
  for (const [path, body] of Object.entries(files)) {
    const full = join(src, path)
    await mkdir(join(full, '..'), { recursive: true })
    await writeFile(full, body)
    entries.push({ path, size: Buffer.byteLength(body), sha256: sha256(Buffer.from(body)) })
  }
  return { src, manifest: { id: 'hardwood', version: 'v1', builtAt: '', files: entries } }
}

const exists = (p: string) => access(p).then(() => true, () => false)

describe('installVerified', () => {
  it('copies every file and reports progress to done', async () => {
    const { src, manifest } = await fixture({ 'index.html': '<p>hi</p>', 'assets/a.js': 'x=1' })
    const target = join(await mkdtemp(join(tmpdir(), 'hw-dst-')), 'v1')
    const seen: string[] = []
    await installVerified(manifest, src, target, (p) => seen.push(`${p.phase}:${p.done}/${p.total}`))
    expect(await readFile(join(target, 'assets/a.js'), 'utf8')).toBe('x=1')
    expect(seen).toEqual(['copying:1/2', 'copying:2/2', 'done:2/2'])
    expect(await exists(`${target}.partial`)).toBe(false)
  })

  it('refuses a corrupted file and leaves no install behind', async () => {
    const { src, manifest } = await fixture({ 'index.html': 'ok', 'engine.wasm': 'real' })
    await writeFile(join(src, 'engine.wasm'), 'tampered')
    const target = join(await mkdtemp(join(tmpdir(), 'hw-dst-')), 'v1')
    await expect(installVerified(manifest, src, target)).rejects.toThrow(/engine\.wasm/)
    expect(await exists(target)).toBe(false)
    expect(await exists(`${target}.partial`)).toBe(false)
  })

  it('keeps the previous install playable when an update fails', async () => {
    const good = await fixture({ 'index.html': 'v1' })
    const target = join(await mkdtemp(join(tmpdir(), 'hw-dst-')), 'game')
    await installVerified(good.manifest, good.src, target)
    const bad = await fixture({ 'index.html': 'v2' })
    await writeFile(join(bad.src, 'index.html'), 'broken')
    await expect(installVerified(bad.manifest, bad.src, target)).rejects.toThrow()
    expect(await readFile(join(target, 'index.html'), 'utf8')).toBe('v1')
  })
})

describe('isSafeRelativePath', () => {
  it.each(['index.html', 'assets/a.js'])('accepts %s', (p) => expect(isSafeRelativePath(p)).toBe(true))
  it.each(['', '/etc/passwd', '../x', 'a/../../x', 'a//b', 'C:/x', 'a\\b', './a'])('rejects %s', (p) =>
    expect(isSafeRelativePath(p)).toBe(false))
})
