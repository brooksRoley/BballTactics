import type { LauncherApi } from '../../main/ipc'

declare global {
  interface Window {
    launcher: LauncherApi
  }
}
