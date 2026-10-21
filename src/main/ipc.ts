/**
 * Every channel the renderer may call, with the shape of its answer. The
 * preload exposes exactly these and nothing else; main validates every
 * payload it receives, because a sandboxed renderer is still untrusted.
 */
export const CHANNELS = {
  appInfo: 'app:info',
} as const

export type AppInfo = {
  name: string
  version: string
  platform: NodeJS.Platform
  electron: string
}

export type LauncherApi = {
  appInfo: () => Promise<AppInfo>
}
