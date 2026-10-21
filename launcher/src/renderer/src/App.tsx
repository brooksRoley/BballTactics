import { useEffect, useState } from 'react'
import type { AppInfo } from '../../main/ipc'
import GameCard from './GameCard'
import { useLibrary } from './useLibrary'

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const { games, pending, errors, run } = useLibrary()

  useEffect(() => {
    let live = true
    void window.launcher.appInfo().then((next) => {
      if (live) setInfo(next)
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>Hardwood Launcher</h1>
        <p className="shell__meta" aria-live="polite">
          {info ? `v${info.version} · Electron ${info.electron} · ${info.platform}` : 'Starting…'}
        </p>
      </header>
      <section aria-labelledby="library-heading" className="library">
        <h2 id="library-heading">Library</h2>
        {games === null ? (
          <p className="library__empty">Loading library…</p>
        ) : (
          <div className="library__grid">
            {games.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                pending={pending[g.id]}
                error={errors[g.id]}
                onAction={(action) => void run(g.id, action)}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
