import { app, BrowserWindow, ipcMain, protocol, shell, type WebContents } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CHANNELS, type AppInfo, type ProgressEvent, type Result } from './ipc'
import { CATALOG, isGameId, Library, type GameId } from './library'
import { GAME_SCHEME, GAME_SCHEME_PRIVILEGES, serveGameFile } from './protocol'
import { assertSecure, isAppUrl, secureWebPreferences } from './security'
import { Feed } from './updater'

const devServerUrl = process.env['ELECTRON_RENDERER_URL']
// `--smoke` (driven by scripts/smoke.mjs against a local feed): stage
// "install" checks the launcher window, installs from the feed, plays, and
// checks the game runs; stage "update" updates to a one-line change, checks
// it downloaded a small fraction, and rolls back. Exits 0 or 1.
const smoke = process.argv.includes('--smoke')
const smokeStage = process.env['LAUNCHER_SMOKE_STAGE'] === 'update' ? 'update' : 'install'

/**
 * Where releases come from: the feed deploy-pages publishes beside the web
 * game. LAUNCHER_FEED_URL points it elsewhere (the smoke run's local server).
 * The manifest's hashes are only as trustworthy as the feed itself; signing
 * releases is M4's job, alongside code signing.
 */
const DEFAULT_FEED_URL = 'https://brooksroley.github.io/BballTactics/launcher-feed/'

// Tests and smoke runs point the profile at a throwaway directory.
if (process.env['LAUNCHER_USER_DATA']) app.setPath('userData', process.env['LAUNCHER_USER_DATA'])

// Must happen before `ready`: game:// gets fetch, a secure origin, and streaming.
protocol.registerSchemesAsPrivileged([GAME_SCHEME_PRIVILEGES])

const library = new Library({
  feed: new Feed(process.env['LAUNCHER_FEED_URL'] ?? DEFAULT_FEED_URL),
  installRoot: join(app.getPath('userData'), 'games'),
  stateFile: join(app.getPath('userData'), 'library.json'),
})
const gameWindows = new Map<GameId, BrowserWindow>()

function createMainWindow(): BrowserWindow {
  const webPreferences = secureWebPreferences(join(__dirname, '../preload/index.js'))
  assertSecure(webPreferences)

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    show: false,
    backgroundColor: '#14191a',
    title: 'Hardwood Launcher',
    webPreferences,
  })

  win.once('ready-to-show', () => {
    if (!smoke) win.show()
  })
  if (smoke) {
    // A smoke run must end: any unexpected error fails it, and so does a stall.
    setTimeout(() => {
      console.error('smoke: FAIL timed out after 120 s')
      app.exit(1)
    }, 120_000).unref()
    win.webContents.once('did-finish-load', () =>
      runSmoke(win).catch((e: unknown) => {
        console.error(`smoke: FAIL ${e instanceof Error ? e.message : String(e)}`)
        app.exit(1)
      }),
    )
    win.webContents.once('did-fail-load', (_e, code, description) => {
      console.error(`smoke: load failed (${code}) ${description}`)
      app.exit(1)
    })
  }

  // Links to the outside world open in the user's browser, never in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, devServerUrl)) event.preventDefault()
  })

  if (devServerUrl) void win.loadURL(devServerUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

/** One window per game, served from game://<id>/ with no preload. */
function openGameWindow(id: GameId): BrowserWindow {
  const existing = gameWindows.get(id)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return existing
  }
  const webPreferences = secureWebPreferences()
  assertSecure(webPreferences)
  const name = CATALOG.find((g) => g.id === id)?.name ?? id
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    show: !smoke,
    backgroundColor: '#111111',
    title: name,
    webPreferences,
  })
  const origin = `${GAME_SCHEME}://${id}/`
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) event.preventDefault()
  })
  win.on('closed', () => gameWindows.delete(id))
  gameWindows.set(id, win)
  void win.loadURL(`${origin}index.html`)
  return win
}

function sendProgress(to: WebContents, e: ProgressEvent): void {
  if (!to.isDestroyed()) to.send(CHANNELS.libraryProgress, e)
}

async function attempt(fn: () => Promise<void> | void): Promise<Result> {
  try {
    await fn()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function registerIpc(): void {
  ipcMain.handle(CHANNELS.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
  }))
  ipcMain.handle(CHANNELS.libraryList, () => library.list())
  ipcMain.handle(CHANNELS.libraryInstall, (event, id: unknown) =>
    attempt(async () => {
      if (!isGameId(id)) throw new Error('Unknown game')
      await library.install(id, (p) => sendProgress(event.sender, { id, ...p }))
    }),
  )
  ipcMain.handle(CHANNELS.libraryPause, (_event, id: unknown) =>
    attempt(() => {
      if (!isGameId(id)) throw new Error('Unknown game')
      library.pause(id)
    }),
  )
  ipcMain.handle(CHANNELS.libraryRollback, (_event, id: unknown) =>
    attempt(async () => {
      if (!isGameId(id)) throw new Error('Unknown game')
      gameWindows.get(id)?.close()   // the running version is about to stop being current
      await library.rollback(id)
    }),
  )
  ipcMain.handle(CHANNELS.libraryUninstall, (_event, id: unknown) =>
    attempt(async () => {
      if (!isGameId(id)) throw new Error('Unknown game')
      gameWindows.get(id)?.close()
      await library.uninstall(id)
    }),
  )
  ipcMain.handle(CHANNELS.libraryPlay, (_event, id: unknown) =>
    attempt(async () => {
      if (!isGameId(id)) throw new Error('Unknown game')
      if (!(await library.installDir(id))) throw new Error('Install it first')
      openGameWindow(id)
    }),
  )
}

/**
 * The launcher window checks, then install → play → the game runs, all
 * driven through the same bridge the UI uses. Exits 0 only if every step held.
 */
async function runSmoke(win: BrowserWindow): Promise<void> {
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>
  // LAUNCHER_SMOKE_SHOTS=<dir> saves what each step looked like (CI can upload them).
  const shots = process.env['LAUNCHER_SMOKE_SHOTS']
  const shot = async (w: BrowserWindow, name: string) => {
    if (shots) await writeFile(join(shots, `${name}.png`), (await w.webContents.capturePage()).toPNG())
  }
  const fail = (why: string) => {
    console.error(`smoke: FAIL ${why}`)
    app.exit(1)
  }
  await new Promise((r) => setTimeout(r, 1500))
  const page = await js<{ bridge: boolean; node: boolean; meta: string }>(`({
    bridge: typeof window.launcher?.library?.install === 'function',
    node: typeof require !== 'undefined' || typeof process !== 'undefined',
    meta: document.querySelector('.shell__meta')?.textContent ?? '',
  })`)
  console.log(`smoke: bridge=${page.bridge} node-in-renderer=${page.node} meta="${page.meta}"`)
  if (!page.bridge || page.node || !page.meta.startsWith('v')) return fail('launcher window')
  if (smokeStage === 'update') return smokeUpdate(js, shot, win, fail)
  await shot(win, '1-library')

  const install = await js<Result>(`window.launcher.library.install('hardwood')`)
  if (!install.ok) return fail(`install: ${install.error}`)
  const [game] = await js<Array<{ installed: { version: string } | null }>>(`window.launcher.library.list()`)
  console.log(`smoke: installed ${game?.installed?.version}`)
  await new Promise((r) => setTimeout(r, 300))
  await shot(win, '2-installed')

  const gameErrors: string[] = []
  const opened = new Promise<BrowserWindow>((resolve) => app.once('browser-window-created', (_e, w) => resolve(w)))
  const play = await js<Result>(`window.launcher.library.play('hardwood')`)
  if (!play.ok) return fail(`play: ${play.error}`)
  const gw = await opened
  gw.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) gameErrors.push(message)
  })
  await new Promise<void>((resolve) => gw.webContents.once('did-finish-load', () => resolve()))
  await new Promise((r) => setTimeout(r, 4000))   // engine init + first render
  const g = (await gw.webContents.executeJavaScript(`({
    title: document.title,
    engine: typeof Module === 'function',
    text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 80),
  })`)) as { title: string; engine: boolean; text: string }
  console.log(`smoke: game title="${g.title}" engine=${g.engine} text="${g.text}"`)
  await shot(gw, '3-game')
  if (gameErrors.length) console.log(`smoke: game console errors:\n  ${gameErrors.join('\n  ')}`)
  const ok = g.title === 'Hardwood Autochess' && g.engine && g.text.includes('Hardwood')
  app.exit(ok ? 0 : 1)
}

type Entry = { installed: { version: string } | null; previous: { version: string } | null; available: { version: string } | null }

/** Update to the feed's newer release, check how little it fetched, roll back. */
async function smokeUpdate(
  js: <T>(code: string) => Promise<T>,
  shot: (w: BrowserWindow, name: string) => Promise<void>,
  win: BrowserWindow,
  fail: (why: string) => void,
): Promise<void> {
  const [before] = await js<Entry[]>(`window.launcher.library.list()`)
  console.log(`smoke: installed ${before?.installed?.version}, feed has ${before?.available?.version}`)
  if (!before?.installed || !before.available || before.installed.version === before.available.version) {
    return fail('expected an installed version and a newer one in the feed')
  }
  await new Promise((r) => setTimeout(r, 300))
  await shot(win, '4-update-available')
  await js(`window.__done = null; window.launcher.library.onProgress((e) => { if (e.phase === 'done') window.__done = e }); true`)
  const update = await js<Result>(`window.launcher.library.install('hardwood')`)
  if (!update.ok) return fail(`update: ${update.error}`)
  const done = await js<ProgressEvent | null>(`window.__done`)
  const [after] = await js<Entry[]>(`window.launcher.library.list()`)
  const fraction = done && done.releaseBytes ? (done.downloadedBytes ?? 0) / done.releaseBytes : 1
  console.log(
    `smoke: updated to ${after?.installed?.version}: downloaded ${done?.downloadedBytes} of ${done?.releaseBytes} bytes ` +
      `(${(fraction * 100).toFixed(1)}%), previous ${after?.previous?.version}`,
  )
  await new Promise((r) => setTimeout(r, 300))
  await shot(win, '5-updated')
  if (after?.installed?.version !== before.available.version || after.previous?.version !== before.installed.version) {
    return fail('update did not record current/previous')
  }
  if (fraction > 0.2) return fail(`a one-line change downloaded ${(fraction * 100).toFixed(1)}% of the release`)

  const rollback = await js<Result>(`window.launcher.library.rollback('hardwood')`)
  const [rolled] = await js<Entry[]>(`window.launcher.library.list()`)
  console.log(`smoke: rolled back to ${rolled?.installed?.version}`)
  if (!rollback.ok || rolled?.installed?.version !== before.installed.version) return fail('rollback')
  app.exit(0)
}

// No window may attach a <webview>, whatever created it.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

void app.whenReady().then(() => {
  protocol.handle(GAME_SCHEME, async (request) => {
    const id = new URL(request.url).hostname
    return serveGameFile(isGameId(id) ? await library.installDir(id) : null, request.url)
  })
  registerIpc()
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
