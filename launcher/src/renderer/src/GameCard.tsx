import { useState, useSyncExternalStore } from 'react'
import type { GameEntry } from '../../main/ipc'
import { getSnapshot, speed, subscribe } from './progressStore'
import type { Action } from './useLibrary'

type Props = {
  game: GameEntry
  pending?: Action
  error?: string
  onAction: (action: Action) => void
}

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function seconds(s: number): string {
  return s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`
}

const PHASE_LABEL = {
  checking: 'Checking what you already have…',
  downloading: 'Downloading',
  assembling: 'Verifying and installing…',
  done: 'Done',
} as const

export default function GameCard({ game, pending, error, onAction }: Props) {
  const progress = useSyncExternalStore(subscribe, getSnapshot)[game.id]
  const [confirming, setConfirming] = useState(false)
  const { installed, previous, available } = game
  const busy = game.busy || pending === 'install'
  const updatable = !!installed && !!available && available.version !== installed.version
  const live = busy && progress && progress.phase !== 'done' ? progress : null

  let status: string
  if (live) status = PHASE_LABEL[live.phase]
  else if (busy) status = 'Starting…'
  else if (game.paused) status = 'Paused. What downloaded so far is saved.'
  else if (updatable) status = `Update available · ${available.version}`
  else if (installed) status = `Installed · ${installed.version}${game.offline ? ' · offline, can’t check for updates' : ''}`
  else if (available) status = `Not installed · ${size(available.bytes)}`
  else status = 'Offline. Can’t reach the update server.'

  let primary: { label: string; action: Action; disabled: boolean }
  if (busy) primary = { label: pending === 'pause' ? 'Pausing…' : 'Updating…', action: 'install', disabled: true }
  else if (game.paused) primary = { label: 'Resume', action: 'install', disabled: game.offline }
  else if (updatable) primary = { label: 'Update', action: 'install', disabled: false }
  else if (installed) primary = { label: pending === 'play' ? 'Opening…' : 'Play', action: 'play', disabled: !!pending }
  else primary = { label: 'Install', action: 'install', disabled: !available }

  const rate = live?.phase === 'downloading' ? speed(live) : null
  const left = live && rate ? (live.bytesTotal - live.bytesDone) / rate : null
  const summary = !busy && progress?.phase === 'done' && progress.downloadedBytes !== undefined ? progress : null

  return (
    <article className="game" aria-labelledby={`game-${game.id}`} aria-busy={busy}>
      <div className="game__art" aria-hidden="true">
        <span className="game__court" />
        <span className="game__mark">HW</span>
      </div>
      <div className="game__body">
        <h3 id={`game-${game.id}`}>{game.name}</h3>
        <p className="game__tagline">{game.tagline}</p>
        <p className="game__status">{status}</p>

        {live && (
          <div className="game__progress">
            <progress
              max={Math.max(1, live.bytesTotal)}
              value={live.bytesDone}
              aria-label={`${game.name}: ${size(live.bytesDone)} of ${size(live.bytesTotal)}`}
            />
            <span>
              {size(live.bytesDone)} of {size(live.bytesTotal)}
              {rate ? ` · ${size(rate)}/s` : ''}
              {left !== null ? ` · ${seconds(left)} left` : ''}
              {live.reusedBytes > 0 ? ` · reusing ${size(live.reusedBytes)} already installed` : ''}
            </span>
          </div>
        )}

        <p className="game__note" aria-live="polite">
          {summary &&
            (summary.reusedBytes > 0
              ? `Updated: downloaded ${size(summary.downloadedBytes!)}, reused ${size(summary.reusedBytes)} already on disk.`
              : summary.downloadedBytes! > 0
                ? `Installed: downloaded ${size(summary.downloadedBytes!)}.`
                : 'Already up to date.')}
        </p>

        {error && (
          <p className="game__error" role="alert">
            {error}
          </p>
        )}

        <div className="game__actions">
          <button type="button" className="btn btn--primary" disabled={primary.disabled} onClick={() => onAction(primary.action)}>
            {primary.label}
          </button>
          {live?.phase === 'downloading' && (
            <button type="button" className="btn" disabled={pending === 'pause'} onClick={() => onAction('pause')}>
              Pause
            </button>
          )}
          {updatable && !busy && (
            <button type="button" className="btn" onClick={() => onAction('play')}>
              Play {installed.version}
            </button>
          )}
          {previous && !busy && !confirming && (
            <button type="button" className="btn" disabled={!!pending} onClick={() => onAction('rollback')}>
              Roll back to {previous.version}
            </button>
          )}
          {installed && !busy && !confirming && (
            <button type="button" className="btn" disabled={!!pending} onClick={() => setConfirming(true)}>
              Uninstall
            </button>
          )}
          {confirming && (
            <span className="game__confirm" role="group" aria-label="Confirm uninstall">
              <span>Remove every installed version?</span>
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
