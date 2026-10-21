import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { installVerified, readManifest, writeJsonAtomic, type InstallProgress } from './install'
import type { GameEntry } from './ipc'

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

type State = { games: Partial<Record<GameId, { version: string; installedAt: string }>> }

export type LibraryPaths = {
  /** Staged builds: <payloadRoot>/<id>/manifest.json + files/ (M2 swaps this for a release feed). */
  payloadRoot: string
  /** Installs live at <installRoot>/<id>/current. */
  installRoot: string
  stateFile: string
}

export class Library {
  private busy = new Set<GameId>()

  constructor(private readonly paths: LibraryPaths) {}

  private async state(): Promise<State> {
    try {
      return JSON.parse(await readFile(this.paths.stateFile, 'utf8')) as State
    } catch {
      return { games: {} }
    }
  }

  /** The directory an installed game is served from, or null. */
  async installDir(id: GameId): Promise<string | null> {
    return (await this.state()).games[id] ? join(this.paths.installRoot, id, 'current') : null
  }

  async list(): Promise<GameEntry[]> {
    const state = await this.state()
    return Promise.all(
      CATALOG.map(async (g) => {
        let available: GameEntry['available'] = null
        try {
          const m = await readManifest(join(this.paths.payloadRoot, g.id, 'manifest.json'))
          available = { version: m.version, bytes: m.files.reduce((n, f) => n + f.size, 0), files: m.files.length }
        } catch {
          /* nothing staged for this game */
        }
        return { ...g, installed: state.games[g.id] ?? null, available, busy: this.busy.has(g.id) }
      }),
    )
  }

  /**
   * Installs (or updates to) the staged build, verifying every file. "done" is
   * reported only after the install is recorded and no longer busy, so a
   * listener that re-reads the library on "done" sees the finished state.
   */
  async install(id: GameId, onProgress: (p: InstallProgress) => void = () => {}): Promise<void> {
    if (this.busy.has(id)) throw new Error(`${id} is already installing`)
    this.busy.add(id)
    let total = 0
    try {
      const source = join(this.paths.payloadRoot, id)
      const manifest = await readManifest(join(source, 'manifest.json'))
      if (manifest.id !== id) throw new Error(`Manifest is for ${manifest.id}, not ${id}`)
      total = manifest.files.length
      await installVerified(manifest, join(source, 'files'), join(this.paths.installRoot, id, 'current'), (p) => {
        if (p.phase !== 'done') onProgress(p)
      })
      const state = await this.state()
      state.games[id] = { version: manifest.version, installedAt: new Date().toISOString() }
      await writeJsonAtomic(this.paths.stateFile, state)
    } finally {
      this.busy.delete(id)
    }
    onProgress({ phase: 'done', done: total, total })
  }

  async uninstall(id: GameId): Promise<void> {
    if (this.busy.has(id)) throw new Error(`${id} is installing`)
    const state = await this.state()
    delete state.games[id]
    await writeJsonAtomic(this.paths.stateFile, state)   // forget it first: a half-deleted dir is never served
    await rm(join(this.paths.installRoot, id), { recursive: true, force: true })
  }
}
