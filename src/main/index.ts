import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { CHANNELS, type AppInfo } from './ipc'
import { assertSecure, isAppUrl, secureWebPreferences } from './security'

const devServerUrl = process.env['ELECTRON_RENDERER_URL']
// `--smoke`: open the window, wait for the page to load, quit with 0. CI uses
// it to prove the built app actually starts, not just that it compiles.
const smoke = process.argv.includes('--smoke')

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
    win.webContents.once('did-finish-load', async () => {
      // Give React a moment to render and the bridge a moment to answer.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const page = (await win.webContents.executeJavaScript(`({
        bridge: typeof window.launcher?.appInfo === 'function',
        node: typeof require !== 'undefined' || typeof process !== 'undefined',
        meta: document.querySelector('.shell__meta')?.textContent ?? '',
      })`)) as { bridge: boolean; node: boolean; meta: string }
      const ok = page.bridge && !page.node && page.meta.startsWith('v')
      console.log(`smoke: bridge=${page.bridge} node-in-renderer=${page.node} meta="${page.meta}"`)
      app.exit(ok ? 0 : 1)
    })
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

function registerIpc(): void {
  ipcMain.handle(CHANNELS.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
  }))
}

// No window may attach a <webview>, whatever created it.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

void app.whenReady().then(() => {
  registerIpc()
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
