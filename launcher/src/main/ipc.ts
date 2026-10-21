/**
 * Every channel the renderer may call, with the shape of its answer. The
 * preload exposes exactly these and nothing else; main validates every
 * payload it receives, because a sandboxed renderer is still untrusted.
 */
export const CHANNELS = {
  appInfo: 'app:info',
  libraryList: 'library:list',
  libraryInstall: 'library:install',
  libraryPause: 'library:pause',
  libraryRollback: 'library:rollback',
  libraryUninstall: 'library:uninstall',
  libraryPlay: 'library:play',
  /** main → renderer: install / update progress events. */
  libraryProgress: 'library:progress',
} as const

export type AppInfo = {
  name: string
  version: string
  platform: NodeJS.Platform
  electron: string
}

type Installed = { version: string; installedAt: string }

export type GameEntry = {
  id: string
  name: string
  tagline: string
  installed: Installed | null
  /** Kept on disk so rollback is instant. */
  previous: Installed | null
  /** The feed's latest release; null when the feed can't be reached. */
  available: { version: string; bytes: number; files: number } | null
  offline: boolean
  busy: boolean
  paused: boolean
}

export type ProgressEvent = {
  id: string
  phase: 'checking' | 'downloading' | 'assembling' | 'done'
  /** Network bytes this release needs, and how many are on disk so far. */
  bytesTotal: number
  bytesDone: number
  /** Bytes taken from the installed version instead of the network. */
  reusedBytes: number
  releaseBytes: number
  /** On "done": what this update actually downloaded. */
  downloadedBytes?: number
}

/** An action's outcome; errors come back as text so the UI can show them. */
export type Result = { ok: true } | { ok: false; error: string }

export type LauncherApi = {
  appInfo: () => Promise<AppInfo>
  library: {
    list: () => Promise<GameEntry[]>
    /** Install, update or resume: all three are "bring me to the latest release". */
    install: (id: string) => Promise<Result>
    pause: (id: string) => Promise<Result>
    rollback: (id: string) => Promise<Result>
    uninstall: (id: string) => Promise<Result>
    play: (id: string) => Promise<Result>
    /** Subscribe to progress; returns the unsubscribe function. */
    onProgress: (listener: (e: ProgressEvent) => void) => () => void
  }
}
