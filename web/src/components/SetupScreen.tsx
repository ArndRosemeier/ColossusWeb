import { useState } from 'react'
import type { NewGameOptions, PlayerKind } from '../engine/types'
import { PLAYER_COLORS } from '../engine/types'
import { MarkerChit } from './MarkerChit'

interface Props {
  onStart: (options: NewGameOptions) => void
}

interface Row {
  name: string
  kind: PlayerKind
  colorId: string
}

export function SetupScreen({ onStart }: Props) {
  const [rows, setRows] = useState<Row[]>([
    { name: 'Player 1', kind: 'human', colorId: 'Red' },
    { name: 'CPU', kind: 'ai', colorId: 'Blue' },
  ])

  const add = () => {
    if (rows.length >= 6) return
    const color = PLAYER_COLORS.find((c) => !rows.some((r) => r.colorId === c.id))!
    setRows([
      ...rows,
      {
        name: `Player ${rows.length + 1}`,
        kind: 'human',
        colorId: color.id,
      },
    ])
  }

  return (
    <div className="setup">
      <header className="hero">
        <p className="brand">Colossus</p>
        <h1>Titan for the web</h1>
        <p className="lede">
          Hotseat and AI on the classic Default map — all TypeScript, no Java runtime.
        </p>
      </header>

      <section className="setup-panel">
        <h2>Players</h2>
        {rows.map((row, i) => (
          <div className="player-row" key={i}>
            <input
              value={row.name}
              onChange={(e) => {
                const next = [...rows]
                next[i] = { ...row, name: e.target.value }
                setRows(next)
              }}
            />
            <select
              value={row.kind}
              onChange={(e) => {
                const next = [...rows]
                next[i] = { ...row, kind: e.target.value as PlayerKind }
                setRows(next)
              }}
            >
              <option value="human">Human</option>
              <option value="ai">AI</option>
            </select>
            <select
              value={row.colorId}
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
                })),
              })
            }
          >
            Start game
          </button>
        </div>
      </section>
    </div>
  )
}
