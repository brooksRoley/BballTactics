import type { ProgressEvent } from '../../main/ipc'

/**
 * Install progress lives outside React: events arrive from main whenever they
 * arrive, at a rate React shouldn't re-render a whole tree for. Components
 * read it through useSyncExternalStore, which gives tear-free snapshots and
 * subscribes to the bridge only while something is listening.
 */
type Snapshot = Readonly<Record<string, ProgressEvent>>

let snapshot: Snapshot = {}
const listeners = new Set<() => void>()
let unsubscribeBridge: (() => void) | null = null

function emit(): void {
  for (const l of listeners) l()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!unsubscribeBridge) {
    unsubscribeBridge = window.launcher.library.onProgress((e) => {
      snapshot = { ...snapshot, [e.id]: e }   // a new object, so React sees the change
      emit()
    })
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && unsubscribeBridge) {
      unsubscribeBridge()
      unsubscribeBridge = null
    }
  }
}

export function getSnapshot(): Snapshot {
  return snapshot
}

export function clearProgress(id: string): void {
  if (!(id in snapshot)) return
  const rest = { ...snapshot }
  delete rest[id]
  snapshot = rest
  emit()
}
