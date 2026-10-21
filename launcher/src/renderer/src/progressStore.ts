import type { ProgressEvent } from '../../main/ipc'

/**
 * Install progress lives outside React: events arrive from main whenever they
 * arrive, at a rate React shouldn't re-render a whole tree for. Components
 * read it through useSyncExternalStore, which gives tear-free snapshots and
 * subscribes to the bridge only while something is listening.
 *
 * Each entry also carries when the download started and how many bytes were
 * already on disk then, so speed and time-left measure this session's
 * transfer, not the resume cache.
 */
export type Tracked = ProgressEvent & { at: number; startAt: number; startBytes: number }

type Snapshot = Readonly<Record<string, Tracked>>

let snapshot: Snapshot = {}
const listeners = new Set<() => void>()
let unsubscribeBridge: (() => void) | null = null

function emit(): void {
  for (const l of listeners) l()
}

function track(e: ProgressEvent): void {
  const prev = snapshot[e.id]
  const now = Date.now()
  const continuing = prev && prev.phase === 'downloading' && e.phase !== 'checking'
  snapshot = {
    ...snapshot,
    [e.id]: {
      ...e,
      at: now,
      startAt: continuing ? prev.startAt : now,
      startBytes: continuing ? prev.startBytes : e.bytesDone,
    },
  }
  emit()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!unsubscribeBridge) unsubscribeBridge = window.launcher.library.onProgress(track)
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

/** Bytes per second over this session's transfer, or null until there's a measurable sample. */
export function speed(t: Tracked): number | null {
  const secs = (t.at - t.startAt) / 1000
  const bytes = t.bytesDone - t.startBytes
  return secs >= 0.25 && bytes > 0 ? bytes / secs : null
}
