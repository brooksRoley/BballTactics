import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { randomBytes, release, serveFeed, tmp } from './test-feed'
import { installRelease, versionDir } from './updater'

describe('installRelease', () => {
  it('installs a release from the feed, every file intact', async () => {
    const feedDir = await tmp()
    const bundle = randomBytes(700 * 1024)
    const rel = await release('v1', bundle, feedDir)
    const { feed } = await serveFeed(feedDir)
    const game = await tmp()
    const r = await installRelease({ feed, release: rel, gameDir: game })
    expect(r.downloadedBytes).toBe(r.releaseBytes)
    expect(await readFile(join(versionDir(game, 'v1'), 'assets/app.js'))).toEqual(bundle)
  })

  it('updates a one-line change by downloading a few KB, not the game', async () => {
    const feedDir = await tmp()
    const bundle = randomBytes(700 * 1024)
    const game = await tmp()
    const v1 = await release('v1', bundle, feedDir)
    await installRelease({ feed: (await serveFeed(feedDir)).feed, release: v1, gameDir: game })

    const edited = Buffer.concat([bundle.subarray(0, 300_000), Buffer.from('\n// one-line change\n'), bundle.subarray(300_000)])
    const v2 = await release('v2', edited, feedDir)
    const { feed, stats } = await serveFeed(feedDir)
    const r = await installRelease({ feed, release: v2, gameDir: game })

    expect(await readFile(join(versionDir(game, 'v2'), 'assets/app.js'))).toEqual(edited)
    expect(r.downloadedBytes).toBe(stats.chunkBytes)
    // Only the chunk(s) around the edit: at most two max-size chunks, and most bytes reused.
    expect(r.downloadedBytes).toBeLessThanOrEqual(2 * 128 * 1024)
    expect(r.reusedBytes / r.releaseBytes).toBeGreaterThan(0.8)
    console.log(`one-line change: downloaded ${r.downloadedBytes} of ${r.releaseBytes} bytes`)
    expect(r.reusedBytes + r.downloadedBytes).toBe(r.releaseBytes)
    expect(await readFile(join(versionDir(game, 'v1'), 'assets/app.js'))).toEqual(bundle)   // v1 untouched
  })

  it('resumes after the network drops, fetching only what it lacks', async () => {
    const feedDir = await tmp()
    const rel = await release('v1', randomBytes(700 * 1024), feedDir)
    const total = new Set(rel.files.flatMap((f) => f.chunks.map((c) => c.hash))).size
    const game = await tmp()

    const flaky = await serveFeed(feedDir, { failAfterChunks: 10 })
    await expect(installRelease({ feed: flaky.feed, release: rel, gameDir: game, concurrency: 1 })).rejects.toThrow()
    expect(await readFile(join(versionDir(game, 'v1'), 'index.html')).catch(() => null)).toBeNull()

    const healthy = await serveFeed(feedDir)
    await installRelease({ feed: healthy.feed, release: rel, gameDir: game })
    expect(healthy.stats.chunkRequests).toBe(total - 10)
  })

  it('refetches a chunk that arrives corrupted', async () => {
    const feedDir = await tmp()
    const rel = await release('v1', randomBytes(300 * 1024), feedDir)
    const bad = rel.files[0]!.chunks[0]!.hash
    const { feed, stats } = await serveFeed(feedDir, { corrupt: new Map([[bad, 1]]) })
    const game = await tmp()
    await installRelease({ feed, release: rel, gameDir: game })
    expect(stats.byHash.get(bad)).toBe(2)
  })

  it('gives up on a chunk that never verifies and leaves the current version playable', async () => {
    const feedDir = await tmp()
    const bundle = randomBytes(300 * 1024)
    const game = await tmp()
    const v1 = await release('v1', bundle, feedDir)
    await installRelease({ feed: (await serveFeed(feedDir)).feed, release: v1, gameDir: game })

    const v2 = await release('v2', randomBytes(300 * 1024, 7), feedDir)
    const bad = v2.files.find((f) => f.path === 'assets/app.js')!.chunks[0]!.hash
    const { feed } = await serveFeed(feedDir, { corrupt: new Map([[bad, 99]]) })
    await expect(installRelease({ feed, release: v2, gameDir: game })).rejects.toThrow(/verification/)
    expect(await readFile(join(versionDir(game, 'v1'), 'assets/app.js'))).toEqual(bundle)
  })

  it('stops on abort and resumes later without refetching what it kept', async () => {
    const feedDir = await tmp()
    const rel = await release('v1', randomBytes(700 * 1024), feedDir)
    const game = await tmp()
    const controller = new AbortController()
    let seen = 0
    const first = await serveFeed(feedDir)
    await expect(
      installRelease({
        feed: first.feed, release: rel, gameDir: game, concurrency: 1, signal: controller.signal,
        onProgress: (p) => { if (p.phase === 'downloading' && p.bytesDone > 0 && ++seen === 5) controller.abort() },
      }),
    ).rejects.toThrow()
    const second = await serveFeed(feedDir)
    const r = await installRelease({ feed: second.feed, release: rel, gameDir: game })
    expect(first.stats.chunkRequests + second.stats.chunkRequests).toBeLessThanOrEqual(
      new Set(rel.files.flatMap((f) => f.chunks.map((c) => c.hash))).size + 1,
    )
    expect(r.version).toBe('v1')
  })
})
