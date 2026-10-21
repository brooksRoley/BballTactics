import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type LauncherApi } from '../main/ipc'

// The renderer's entire view of the system. Add a channel in ../main/ipc.ts
// first, then expose it here; never expose ipcRenderer itself.
const api: LauncherApi = {
  appInfo: () => ipcRenderer.invoke(CHANNELS.appInfo),
}

contextBridge.exposeInMainWorld('launcher', api)
