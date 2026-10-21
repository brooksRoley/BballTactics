/**
 * Every channel the renderer may call, with the shape of its answer. The
 * preload exposes exactly these and nothing else; main validates every
 * payload it receives, because a sandboxed renderer is still untrusted.
 */
export const CHANNELS = {
  appInfo: 'app:info',
  libraryList: 'library:list',
  libraryInstall: 'library:install',
  libraryUninstall: 'library:uninstall',
  libraryPlay: 'library:play',
  /** main → renderer: install progress events. */
  libraryProgress: 'library:progress',
} as const

export type AppInfo = {
  name: string
  version: string
  platform: NodeJS.Platform
  electron: string
}

export type GameEntry = {
  id: string
  name: string
  tagline: string
  installed: { version: string; installedAt: string } | null
  /** The build this launcher can install now (M1: staged locally; M2: the release feed). */
  available: { version: string; bytes: number; files: number } | null
  busy: boolean
}

export type ProgressEvent = { id: string; phase: 'copying' | 'done'; done: number; total: number }

/** An action's outcome; errors come back as text so the UI can show them. */
export type Result = { ok: true } | { ok: false; error: string }

export type LauncherApi = {
  appInfo: () => Promise<AppInfo>
  library: {
    list: () => Promise<GameEntry[]>
    install: (id: string) => Promise<Result>
    uninstall: (id: string) => Promise<Result>
    play: (id: string) => Promise<Result>
    /** Subscribe to install progress; returns the unsubscribe function. */
    onProgress: (listener: (e: ProgressEvent) => void) => () => void
  }
}
