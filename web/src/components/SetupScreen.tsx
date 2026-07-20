import { useState } from 'react'
import type { AiProfileId } from '../ai/profiles'
import { AI_PROFILE_CHOICES } from '../ai/profiles'
import type { NewGameOptions, PlayerKind } from '../engine/types'
import { PLAYER_COLORS } from '../engine/types'
import type { SavedGameMeta } from '../persistence/saveGame'
import { MarkerChit } from './MarkerChit'

interface Props {
  onStart: (options: NewGameOptions) => void
  onContinue?: () => void
  savedGame?: SavedGameMeta | null
}

interface Row {
  name: string
  kind: PlayerKind
  colorId: string
  aiProfileId: AiProfileId
}

function formatSavedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function SetupScreen({ onStart, onContinue, savedGame }: Props) {
  const [rows, setRows] = useState<Row[]>([
    { name: 'Player 1', kind: 'human', colorId: 'Red', aiProfileId: 'balanced' },
    { name: 'CPU', kind: 'ai', colorId: 'Blue', aiProfileId: 'balanced' },
  ])

  const add = () => {
    if (rows.length >= 6) return
    const color = PLAYER_COLORS.find((c) => !rows.some((r) => r.colorId === c.id))!
    setRows([
      ...rows,
      {
        name: `Player ${rows.length + 1}`,
        kind: 'ai',
        colorId: color.id,
        aiProfileId: 'balanced',
      },
    ])
  }

  return (
    <div className="setup">
      <header className="hero">
        <p className="brand">Colossus</p>
        <h1>Masterboard awaits</h1>
        <p className="lede">
          Raise your Titan. Split, march, and clash on the classic Default map — local hotseat
          and AI, all in the browser.
        </p>
      </header>

      {savedGame && onContinue && (
        <section className="setup-panel continue-panel" aria-label="Continue saved game">
          <h2>Continue</h2>
          <p className="continue-meta">
            {savedGame.players} · Turn {savedGame.turnNumber} · {savedGame.phase}
            <br />
            <span className="muted">Saved {formatSavedAt(savedGame.savedAt)}</span>
          </p>
          <div className="setup-actions">
            <button type="button" className="primary" onClick={onContinue}>
              Load saved game
            </button>
          </div>
        </section>
      )}

      <section className="setup-panel" aria-label="Game setup">
        <h2>Muster players</h2>
        {rows.map((row, i) => (
          <div className="player-row" key={i}>
            <input
              value={row.name}
              aria-label={`Player ${i + 1} name`}
              onChange={(e) => {
                const next = [...rows]
                next[i] = { ...row, name: e.target.value }
                setRows(next)
              }}
            />
            <select
              value={row.kind}
              aria-label={`${row.name} type`}
              onChange={(e) => {
                const next = [...rows]
                next[i] = { ...row, kind: e.target.value as PlayerKind }
                setRows(next)
              }}
            >
              <option value="human">Human</option>
              <option value="ai">AI</option>
            </select>
            {row.kind === 'ai' && (
              <select
                value={row.aiProfileId}
                title="AI personality"
                aria-label={`${row.name} AI personality`}
                onChange={(e) => {
                  const next = [...rows]
                  next[i] = { ...row, aiProfileId: e.target.value as AiProfileId }
                  setRows(next)
                }}
              >
                {AI_PROFILE_CHOICES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
            <select
              value={row.colorId}
              aria-label={`${row.name} color`}
              onChange={(e) => {
                const next = [...rows]
                next[i] = { ...row, colorId: e.target.value }
                setRows(next)
              }}
            >
              {PLAYER_COLORS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <MarkerChit
              markerId={`${PLAYER_COLORS.find((c) => c.id === row.colorId)?.shortName ?? 'Rd'}01`}
              size={28}
            />
            {rows.length > 2 && (
              <button
                type="button"
                className="ghost"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <div className="setup-actions">
          <button type="button" className="ghost" onClick={add} disabled={rows.length >= 6}>
            Add player
          </button>
          <button
            type="button"
            className="primary"
            onClick={() =>
              onStart({
                players: rows.map((r) => ({
                  name: r.name,
                  kind: r.kind,
                  colorId: r.colorId,
                  aiProfileId: r.kind === 'ai' ? r.aiProfileId : undefined,
                })),
              })
            }
          >
            Begin campaign
          </button>
        </div>
      </section>
    </div>
  )
}
