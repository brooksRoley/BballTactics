import { useCallback, useEffect, useReducer } from 'react'
import type { GameEntry, Result } from '../../main/ipc'
import { clearProgress } from './progressStore'

type Action = 'install' | 'uninstall' | 'play'

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
    // Refresh on any finished install, not only ones this window started: an
    // install can come from elsewhere (the smoke run today, updates in M2).
    return window.launcher.library.onProgress((e) => {
      if (e.phase === 'done') void refresh()
    })
  }, [refresh])

  const run = useCallback(
    async (id: string, action: Action) => {
      dispatch({ type: 'started', id, action })
      const result: Result = await window.launcher.library[action](id)
      dispatch({ type: 'finished', id, error: result.ok ? undefined : result.error })
      if (action !== 'play') {
        clearProgress(id)
        await refresh()
      }
    },
    [refresh],
  )

  return { ...state, run }
}
