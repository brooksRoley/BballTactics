import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveGamePath, serveGameFile } from './protocol'

describe('resolveGamePath', () => {
  const root = '/games/hardwood/v1'
  it('maps the root to index.html', () => expect(resolveGamePath(root, '/')).toBe(`${root}/index.html`))
  it('maps nested assets', () => expect(resolveGamePath(root, '/assets/a.js')).toBe(`${root}/assets/a.js`))
  it.each(['/../secrets', '/assets/../../x', '/%2e%2e/x', '/a%00b', '/%E0%A4%A'])('refuses %s', (p) =>
    expect(resolveGamePath(root, p)).toBeNull())
})

describe('serveGameFile', () => {
  it('serves wasm with its type and the game CSP', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hw-proto-'))
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'engine.wasm'), Buffer.from([0, 97, 115, 109]))
    const res = await serveGameFile(dir, 'game://hardwood/engine.wasm')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/wasm')
    expect(res.headers.get('content-security-policy')).toContain("connect-src 'self'")
  })

  it('404s when the game is not installed or the file is missing', async () => {
    expect((await serveGameFile(null, 'game://hardwood/index.html')).status).toBe(404)
    const dir = await mkdtemp(join(tmpdir(), 'hw-proto-'))
    expect((await serveGameFile(dir, 'game://hardwood/api/bball/roster')).status).toBe(404)
  })
})
