import { useCallback, useEffect, useReducer } from 'react'
import type { GameEntry, Result } from '../../main/ipc'
import { clearProgress } from './progressStore'

export type Action = 'install' | 'pause' | 'rollback' | 'uninstall' | 'play'

type State = {
  games: GameEntry[] | null
  /** The action in flight per game, so its buttons can say what's happening. */
  pending: Record<string, Action | undefined>
  errors: Record<string, string | undefined>
}

type Msg =
  | { type: 'loaded'; games: GameEntry[] }
  | { type: 'started'; id: string; action: Action }
  | { type: 'finished'; id: string; error?: string }

function reducer(state: State, msg: Msg): State {
  switch (msg.type) {
    case 'loaded':
      return { ...state, games: msg.games }
    case 'started':
      return { ...state, pending: { ...state.pending, [msg.id]: msg.action }, errors: { ...state.errors, [msg.id]: undefined } }
    case 'finished':
      return { ...state, pending: { ...state.pending, [msg.id]: undefined }, errors: { ...state.errors, [msg.id]: msg.error } }
  }
}

export function useLibrary() {
  const [state, dispatch] = useReducer(reducer, { games: null, pending: {}, errors: {} })

  const refresh = useCallback(async () => {
    dispatch({ type: 'loaded', games: await window.launcher.library.list() })
  }, [])

  useEffect(() => {
    void refresh()
    // Refresh on any finished install, not only ones this window started.
    return window.launcher.library.onProgress((e) => {
      if (e.phase === 'done') void refresh()
    })
  }, [refresh])

  const run = useCallback(
    async (id: string, action: Action) => {
      if (action === 'install') clearProgress(id)   // drop the last update's summary
      // Pause doesn't own the card: the install it interrupts reports the outcome.
      if (action !== 'pause') dispatch({ type: 'started', id, action })
      else void refresh()
      const result: Result = await window.launcher.library[action](id)
      const error = result.ok || result.error === 'Paused' ? undefined : result.error
      if (action !== 'pause') dispatch({ type: 'finished', id, error })
      if (action !== 'play') await refresh()
    },
    [refresh],
  )

  return { ...state, run }
}
