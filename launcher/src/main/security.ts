import type { WebPreferences } from 'electron'

/**
 * The only web preferences a launcher window may use. The renderer shows
 * content from the network (release notes, manifests), so it gets no Node,
 * no direct Electron access, and a sandboxed process; everything it needs
 * goes through the typed preload API.
 */
export function secureWebPreferences(preload?: string): WebPreferences {
  return {
    // A game window gets no preload at all: it never talks to main.
    ...(preload ? { preload } : {}),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
  }
}

/** Throws if a window would be created with weaker settings than the baseline. */
export function assertSecure(prefs: WebPreferences): void {
  const problems: string[] = []
  if (prefs.contextIsolation !== true) problems.push('contextIsolation must be true')
  if (prefs.sandbox !== true) problems.push('sandbox must be true')
  if (prefs.nodeIntegration !== false) problems.push('nodeIntegration must be false')
  if (prefs.nodeIntegrationInWorker === true) problems.push('nodeIntegrationInWorker must not be true')
  if (prefs.webSecurity === false) problems.push('webSecurity must not be false')
  if (prefs.allowRunningInsecureContent === true) problems.push('allowRunningInsecureContent must not be true')
  if (prefs.webviewTag === true) problems.push('webviewTag must not be true')
  if (problems.length) throw new Error(`Insecure window: ${problems.join('; ')}`)
}

/** Navigation and new windows may only stay on the app's own pages. */
export function isAppUrl(url: string, devServerUrl?: string): boolean {
  if (devServerUrl && url.startsWith(devServerUrl)) return true
  return url.startsWith('file://')
}
