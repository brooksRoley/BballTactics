import { useState, useSyncExternalStore } from 'react'
import type { GameEntry } from '../../main/ipc'
import { getSnapshot, subscribe } from './progressStore'

type Props = {
  game: GameEntry
  pending?: 'install' | 'uninstall' | 'play'
  error?: string
  onAction: (action: 'install' | 'uninstall' | 'play') => void
}

function size(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

export default function GameCard({ game, pending, error, onAction }: Props) {
  const progress = useSyncExternalStore(subscribe, getSnapshot)[game.id]
  const [confirming, setConfirming] = useState(false)
  const { installed, available } = game
  const updatable = !!installed && !!available && available.version !== installed.version
  const installing = pending === 'install' || game.busy

  let status: string
  if (installing) status = 'Installing…'
  else if (updatable) status = `Update available · ${available.version}`
  else if (installed) status = `Installed · ${installed.version}`
  else if (available) status = `Not installed · ${size(available.bytes)}`
  else status = 'No build staged yet. Run `npm run stage-game` in launcher/.'

  const primary = installed && !updatable
    ? { label: pending === 'play' ? 'Opening…' : 'Play', action: 'play' as const }
    : { label: installing ? 'Installing…' : updatable ? 'Update' : 'Install', action: 'install' as const }

  return (
    <article className="game" aria-labelledby={`game-${game.id}`}>
      <div className="game__art" aria-hidden="true">
        <span className="game__court" />
        <span className="game__mark">HW</span>
      </div>
      <div className="game__body">
        <h3 id={`game-${game.id}`}>{game.name}</h3>
        <p className="game__tagline">{game.tagline}</p>
        <p className="game__status">{status}</p>

        {installing && progress && (
          <div className="game__progress">
            <progress max={progress.total} value={progress.done} aria-label={`Installing ${game.name}`} />
            <span aria-live="polite">
              {progress.phase === 'done' ? 'Verified' : `Verifying and copying ${progress.done} of ${progress.total} files`}
            </span>
          </div>
        )}

        {error && (
          <p className="game__error" role="alert">
            {error}
          </p>
        )}

        <div className="game__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!!pending || game.busy || (!installed && !available)}
            onClick={() => onAction(primary.action)}
          >
            {primary.label}
          </button>
          {installed && !installing && !confirming && (
            <button type="button" className="btn" disabled={!!pending} onClick={() => setConfirming(true)}>
              Uninstall
            </button>
          )}
          {confirming && (
            <span className="game__confirm" role="group" aria-label="Confirm uninstall">
              <span>Remove the installed files?</span>
              <button type="button" className="btn btn--danger" onClick={() => { setConfirming(false); onAction('uninstall') }}>
                Uninstall
              </button>
              <button type="button" className="btn" autoFocus onClick={() => setConfirming(false)}>
                Keep
              </button>
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
