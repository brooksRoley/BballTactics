import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sha256 } from './install'
import { Library, isGameId } from './library'

async function setup(version = 'v1', body = '<p>game</p>') {
  const root = await mkdtemp(join(tmpdir(), 'hw-lib-'))
  const payload = join(root, 'payload', 'hardwood')
  await mkdir(join(payload, 'files'), { recursive: true })
  await writeFile(join(payload, 'files', 'index.html'), body)
  const manifest = { id: 'hardwood', version, builtAt: '', files: [{ path: 'index.html', size: Buffer.byteLength(body), sha256: sha256(Buffer.from(body)) }] }
  await writeFile(join(payload, 'manifest.json'), JSON.stringify(manifest))
  const lib = new Library({ payloadRoot: join(root, 'payload'), installRoot: join(root, 'games'), stateFile: join(root, 'library.json') })
  return { root, payload, lib }
}

describe('Library', () => {
  it('lists the staged build before install, and the installed version after', async () => {
    const { lib } = await setup()
    const before = (await lib.list())[0]!
    expect(before.installed).toBeNull()
    expect(before.available).toMatchObject({ version: 'v1', files: 1 })
    await lib.install('hardwood')
    const after = (await lib.list())[0]!
    expect(after.installed?.version).toBe('v1')
    expect(await readFile(join((await lib.installDir('hardwood'))!, 'index.html'), 'utf8')).toBe('<p>game</p>')
  })

  it('reports done only once the install is recorded and no longer busy', async () => {
    const { lib } = await setup()
    let seenAtDone: { installed: unknown; busy: boolean } | null = null
    const finished = new Promise<void>((resolve) => {
      void lib.install('hardwood', (p) => {
        if (p.phase !== 'done') return
        void lib.list().then(([g]) => {
          seenAtDone = { installed: g!.installed, busy: g!.busy }
          resolve()
        })
      })
    })
    await finished
    expect(seenAtDone).toMatchObject({ busy: false })
    expect(seenAtDone!.installed).not.toBeNull()
  })

  it('uninstall forgets the game and removes its files', async () => {
    const { lib } = await setup()
    await lib.install('hardwood')
    await lib.uninstall('hardwood')
    expect(await lib.installDir('hardwood')).toBeNull()
    expect((await lib.list())[0]!.installed).toBeNull()
  })

  it('reports no available build when nothing is staged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hw-lib-'))
    const lib = new Library({ payloadRoot: join(root, 'none'), installRoot: join(root, 'g'), stateFile: join(root, 's.json') })
    expect((await lib.list())[0]!.available).toBeNull()
    await expect(lib.install('hardwood')).rejects.toThrow()
  })

  it('only accepts known game ids from the renderer', () => {
    expect(isGameId('hardwood')).toBe(true)
    for (const bad of ['../x', 'Hardwood', '', 42, null]) expect(isGameId(bad)).toBe(false)
  })
})
