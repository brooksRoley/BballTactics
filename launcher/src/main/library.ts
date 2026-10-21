import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeJsonAtomic } from './install'
import type { GameEntry, ProgressEvent } from './ipc'
import type { Release } from './release'
import { Feed, hasVersion, installRelease, prune, versionDir } from './updater'

/** The games this launcher knows about. One today; the shape allows more. */
export const CATALOG = [
  {
    id: 'hardwood',
    name: 'Hardwood Autochess',
    tagline: 'A basketball auto-battler: draft a roster, call the scheme, let the sim decide.',
  },
] as const

export type GameId = (typeof CATALOG)[number]['id']

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && CATALOG.some((g) => g.id === value)
}

type Installed = { version: string; installedAt: string }
/** `previous` is kept on disk so rollback is a state flip, not a download. */
type State = { games: Partial<Record<GameId, { current: Installed; previous?: Installed }>> }

export type LibraryOptions = { feed: Feed; installRoot: string; stateFile: string; checkTimeoutMs?: number }

type Progress = Omit<ProgressEvent, 'id'>

export class Library {
  private running = new Map<GameId, AbortController>()
  private paused = new Set<GameId>()

  constructor(private readonly opts: LibraryOptions) {}

  private gameDir(id: GameId): string {
    return join(this.opts.installRoot, id)
  }

  private async state(): Promise<State> {
    try {
      const s = JSON.parse(await readFile(this.opts.stateFile, 'utf8')) as State
      return s && typeof s.games === 'object' ? s : { games: {} }
    } catch {
      return { games: {} }
    }
  }

  /** The directory the current version is served from, or null. */
  async installDir(id: GameId): Promise<string | null> {
    const g = (await this.state()).games[id]
    return g?.current ? versionDir(this.gameDir(id), g.current.version) : null
  }

  /** The feed's latest release, or null when the feed can't be reached. */
  private async latest(id: GameId): Promise<Release | null> {
    const signal = AbortSignal.timeout(this.opts.checkTimeoutMs ?? 5000)
    try {
      return await this.opts.feed.release(id, await this.opts.feed.channel(id, signal), signal)
    } catch {
      return null
    }
  }

  async list(): Promise<GameEntry[]> {
    const state = await this.state()
    return Promise.all(
      CATALOG.map(async (g) => {
        const rel = await this.latest(g.id)
        const st = state.games[g.id]
        return {
          ...g,
          installed: st?.current ?? null,
          previous: st?.previous ?? null,
          available: rel
            ? { version: rel.version, bytes: rel.files.reduce((n, f) => n + f.size, 0), files: rel.files.length }
            : null,
          offline: !rel,
          busy: this.running.has(g.id),
          paused: this.paused.has(g.id),
        }
      }),
    )
  }

  /**
   * Installs or updates to the feed's latest release, downloading only what
   * isn't on disk. "done" is reported only after the new version is recorded
   * as current, so a listener re-reading the library sees the finished state.
   * A pause aborts the download; calling install again resumes it.
   */
  async install(id: GameId, onProgress: (p: Progress) => void = () => {}): Promise<void> {
    if (this.running.has(id)) throw new Error(`${id} is already updating`)
    const controller = new AbortController()
    this.running.set(id, controller)
    this.paused.delete(id)
    let summary: Progress | null = null
    try {
      const rel = await this.latest(id)
      if (!rel) throw new Error("Can't reach the update server. Check your connection and try again.")
      const state = await this.state()
      const current = state.games[id]?.current
      if (current?.version === rel.version) {
        summary = { phase: 'done', bytesTotal: 0, bytesDone: 0, reusedBytes: 0, releaseBytes: 0, downloadedBytes: 0 }
        return
      }
      const result = await installRelease({
        feed: this.opts.feed,
        release: rel,
        gameDir: this.gameDir(id),
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase !== 'done') onProgress(p)
        },
      })
      const now: Installed = { version: rel.version, installedAt: new Date().toISOString() }
      state.games[id] = current ? { current: now, previous: current } : { current: now }
      await writeJsonAtomic(this.opts.stateFile, state)
      await prune(this.gameDir(id), [now.version, ...(current ? [current.version] : [])])
      summary = {
        phase: 'done', bytesTotal: 0, bytesDone: 0,
        reusedBytes: result.reusedBytes, releaseBytes: result.releaseBytes, downloadedBytes: result.downloadedBytes,
      }
    } catch (e) {
      if (controller.signal.aborted) {
        this.paused.add(id)
        throw new Error('Paused')
      }
      throw e
    } finally {
      this.running.delete(id)
      if (summary) onProgress(summary)
    }
  }

  /** Stops a running download; every verified chunk is kept for the resume. */
  pause(id: GameId): void {
    this.running.get(id)?.abort()
  }

  /** Makes the previous version current again. Instant: it never left the disk. */
  async rollback(id: GameId): Promise<void> {
    if (this.running.has(id)) throw new Error(`${id} is updating`)
    const state = await this.state()
    const g = state.games[id]
    if (!g?.previous) throw new Error('No previous version to roll back to')
    if (!(await hasVersion(this.gameDir(id), g.previous.version))) throw new Error('The previous version is missing')
    state.games[id] = { current: g.previous, previous: g.current }
    await writeJsonAtomic(this.opts.stateFile, state)
  }

  async uninstall(id: GameId): Promise<void> {
    if (this.running.has(id)) throw new Error(`${id} is updating`)
    const state = await this.state()
    delete state.games[id]
    await writeJsonAtomic(this.opts.stateFile, state)   // forget it first: a half-deleted dir is never served
    this.paused.delete(id)
    await rm(this.gameDir(id), { recursive: true, force: true })
  }
}
