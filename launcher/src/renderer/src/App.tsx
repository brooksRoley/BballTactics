import { useEffect, useState } from 'react'
import type { AppInfo } from '../../main/ipc'

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)

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
        <p>Hardwood Autochess will appear here once install lands (M1).</p>
      </section>
    </main>
  )
}
