import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isSafeRelativePath, sha256, writeJsonAtomic } from './install'

describe('isSafeRelativePath', () => {
  it.each(['index.html', 'assets/a.js'])('accepts %s', (p) => expect(isSafeRelativePath(p)).toBe(true))
  it.each(['', '/etc/passwd', '../x', 'a/../../x', 'a//b', 'C:/x', 'a\\b', './a'])('rejects %s', (p) =>
    expect(isSafeRelativePath(p)).toBe(false))
})

describe('helpers', () => {
  it('hashes with SHA-256', () => {
    expect(sha256(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('writes JSON atomically', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'hw-json-')), 'nested', 'state.json')
    await writeJsonAtomic(file, { a: 1 })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ a: 1 })
  })
})
