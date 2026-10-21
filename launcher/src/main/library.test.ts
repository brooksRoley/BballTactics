import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Library, isGameId } from './library'
import { randomBytes, release, serveFeed, tmp } from './test-feed'
import { Feed } from './updater'

async function setup() {
  const feedDir = await tmp()
  const root = await tmp()
  const bundle = randomBytes(400 * 1024)
  await release('v1', bundle, feedDir)
  const { feed, stats } = await serveFeed(feedDir)
  const lib = new Library({ feed, installRoot: join(root, 'games'), stateFile: join(root, 'library.json') })
  return { feedDir, root, bundle, lib, stats }
}

const first = async (lib: Library) => (await lib.list())[0]!

describe('Library', () => {
  it('lists the feed release before install, and the installed version after', async () => {
    const { lib, bundle } = await setup()
    const before = await first(lib)
    expect(before).toMatchObject({ installed: null, offline: false, available: { version: 'v1', files: 2 } })
    await lib.install('hardwood')
    const after = await first(lib)
    expect(after.installed?.version).toBe('v1')
    expect(await readFile(join((await lib.installDir('hardwood'))!, 'assets/app.js'))).toEqual(bundle)
  })

  it('reports done only once the install is recorded and no longer busy', async () => {
    const { lib } = await setup()
    let atDone: { installed: unknown; busy: boolean } | null = null
    await new Promise<void>((resolve) => {
      void lib.install('hardwood', (p) => {
        if (p.phase === 'done') void first(lib).then((g) => { atDone = g; resolve() })
      })
    })
    expect(atDone).toMatchObject({ busy: false })
    expect(atDone!.installed).not.toBeNull()
  })

  it('updates to a newer release, keeps the previous one, and rolls back instantly', async () => {
    const { lib, feedDir, bundle } = await setup()
    await lib.install('hardwood')
    const edited = Buffer.concat([bundle.subarray(0, 200_000), Buffer.from('// tweak\n'), bundle.subarray(200_000)])
    await release('v2', edited, feedDir)
    expect((await first(lib)).available?.version).toBe('v2')

    let done: { downloadedBytes?: number; releaseBytes: number } | null = null
    await lib.install('hardwood', (p) => { if (p.phase === 'done') done = p })
    expect(await first(lib)).toMatchObject({ installed: { version: 'v2' }, previous: { version: 'v1' } })
    expect(done!.downloadedBytes!).toBeLessThan(done!.releaseBytes * 0.5)

    await lib.rollback('hardwood')
    expect(await first(lib)).toMatchObject({ installed: { version: 'v1' }, previous: { version: 'v2' } })
    expect(await readFile(join((await lib.installDir('hardwood'))!, 'assets/app.js'))).toEqual(bundle)
  })

  it('keeps an installed game playable when the feed is unreachable', async () => {
    const { lib, root } = await setup()
    await lib.install('hardwood')
    const offline = new Library({
      feed: new Feed('http://127.0.0.1:9/'), installRoot: join(root, 'games'), stateFile: join(root, 'library.json'),
      checkTimeoutMs: 500,
    })
    expect(await first(offline)).toMatchObject({ offline: true, available: null, installed: { version: 'v1' } })
    expect(await offline.installDir('hardwood')).not.toBeNull()
    await expect(offline.install('hardwood')).rejects.toThrow(/update server/)
  })

  it('pauses mid-download and resumes from where it stopped', async () => {
    const { lib, stats } = await setup()
    await expect(
      lib.install('hardwood', (p) => { if (p.phase === 'downloading' && p.bytesDone > 0) lib.pause('hardwood') }),
    ).rejects.toThrow('Paused')
    expect(await first(lib)).toMatchObject({ paused: true, busy: false, installed: null })
    const afterPause = stats.chunkRequests
    await lib.install('hardwood')
    expect(await first(lib)).toMatchObject({ paused: false, installed: { version: 'v1' } })
    expect(afterPause).toBeGreaterThan(0)
  })

  it('uninstall forgets the game and removes its files', async () => {
    const { lib } = await setup()
    await lib.install('hardwood')
    await lib.uninstall('hardwood')
    expect(await lib.installDir('hardwood')).toBeNull()
    expect((await first(lib)).installed).toBeNull()
  })

  it('only accepts known game ids from the renderer', () => {
    expect(isGameId('hardwood')).toBe(true)
    for (const bad of ['../x', 'Hardwood', '', 42, null]) expect(isGameId(bad)).toBe(false)
  })
})
