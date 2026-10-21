import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, type LauncherApi, type ProgressEvent } from '../main/ipc'

// The renderer's entire view of the system. Add a channel in ../main/ipc.ts
// first, then expose it here; never expose ipcRenderer itself.
const api: LauncherApi = {
  appInfo: () => ipcRenderer.invoke(CHANNELS.appInfo),
  library: {
    list: () => ipcRenderer.invoke(CHANNELS.libraryList),
    install: (id) => ipcRenderer.invoke(CHANNELS.libraryInstall, id),
    uninstall: (id) => ipcRenderer.invoke(CHANNELS.libraryUninstall, id),
    play: (id) => ipcRenderer.invoke(CHANNELS.libraryPlay, id),
    onProgress: (listener) => {
      // Strip the IpcRendererEvent: it carries `sender`, which the page must not see.
      const wrapped = (_event: IpcRendererEvent, e: ProgressEvent) => listener(e)
      ipcRenderer.on(CHANNELS.libraryProgress, wrapped)
      return () => {
        ipcRenderer.removeListener(CHANNELS.libraryProgress, wrapped)
      }
    },
  },
}

contextBridge.exposeInMainWorld('launcher', api)
