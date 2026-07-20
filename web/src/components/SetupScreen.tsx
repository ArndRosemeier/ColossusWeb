import { useMemo, useState } from 'react'
import type { AiProfileId } from '../ai/profiles'
import { AI_PROFILE_CHOICES } from '../ai/profiles'
import type { NewGameOptions, PlayerKind } from '../engine/types'
import { PLAYER_COLORS } from '../engine/types'
import type { SavedGameMeta } from '../persistence/saveGame'
import { KNOWN_VARIANTS } from '../variant/loadVariant'
import { BackgroundAtmosphereSelect } from './BackgroundAtmosphere'
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

const VARIANT_META: Record<string, { label: string; maxPlayers: number; blurb: string }> = {
  Default: {
    label: 'Default',
    maxPlayers: 6,
    blurb: 'Classic Avalon Hill Titan masterboard.',
  },
  Abyssal6: {
    label: 'Abyssal6',
    maxPlayers: 6,
    blurb: 'Abyss anti-tower, elementals, Balrog — Titan skill 5, teleport at 1000.',
  },
  Abyssal3: {
    label: 'Abyssal3',
    maxPlayers: 3,
    blurb: 'Three-player Abyssal on a smaller board (Lion/Troll/Cyclops starts).',
  },
  Abyssal9: {
    label: 'Abyssal9',
    maxPlayers: 9,
    blurb: 'Nine-player Abyssal on a huge board — teleport at 1500.',
  },
}

function formatSavedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function SetupScreen({ onStart, onContinue, savedGame }: Props) {
  const [variantName, setVariantName] = useState('Default')
  const meta = VARIANT_META[variantName] ?? VARIANT_META.Default!
  const maxPlayers = meta.maxPlayers

  const [rows, setRows] = useState<Row[]>([
    { name: 'Player 1', kind: 'human', colorId: 'Red', aiProfileId: 'random' },
    { name: 'CPU 1', kind: 'ai', colorId: 'Blue', aiProfileId: 'random' },
    { name: 'CPU 2', kind: 'ai', colorId: 'Green', aiProfileId: 'random' },
  ])

  const cappedRows = useMemo(() => rows.slice(0, maxPlayers), [rows, maxPlayers])

  const add = () => {
    if (cappedRows.length >= maxPlayers) return
    const color = PLAYER_COLORS.find((c) => !cappedRows.some((r) => r.colorId === c.id))!
    setRows([
      ...cappedRows,
      {
        name: `Player ${cappedRows.length + 1}`,
        kind: 'ai',
        colorId: color.id,
        aiProfileId: 'random',
      },
    ])
  }

  const onVariantChange = (name: string) => {
    setVariantName(name)
    const nextMax = VARIANT_META[name]?.maxPlayers ?? 6
    setRows((prev) => prev.slice(0, nextMax))
  }

  return (
    <div className="setup">
      <header className="hero">
        <svg
          className="brand-svg"
          viewBox="0 0 920 220"
          role="img"
          aria-label="Colossus"
          preserveAspectRatio="xMinYMid meet"
          overflow="visible"
        >
          <defs>
            <linearGradient id="colossusBrandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffe0c2" />
              <stop offset="40%" stopColor="#e08a45" />
              <stop offset="78%" stopColor="#ff6b35" />
              <stop offset="100%" stopColor="#ffd4a8" />
            </linearGradient>
          </defs>
          <text
            x="12"
            y="155"
            fill="url(#colossusBrandGrad)"
            fontFamily="Cinzel, Palatino Linotype, serif"
            fontWeight="700"
            fontSize="96"
            letterSpacing="10"
          >
            COLOSSUS
          </text>
        </svg>
        <h1>Masterboard awaits</h1>
        <p className="lede">
          Raise your Titan. Split, march, and clash — local hotseat and AI, all in the browser.
        </p>
      </header>

      {savedGame && onContinue && (
        <section className="setup-panel continue-panel" aria-label="Continue saved game">
          <h2>Continue</h2>
          <p className="continue-meta">
            {savedGame.variantName} · {savedGame.players} · Turn {savedGame.turnNumber} ·{' '}
            {savedGame.phase}
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

      <section className="setup-panel" aria-label="Appearance">
        <h2>Background</h2>
        <BackgroundAtmosphereSelect showBlurb className="bg-atmosphere-select setup-bg" />
      </section>

      <section className="setup-panel" aria-label="Game setup">
        <h2>Variant</h2>
        <div className="player-row">
          <select
            value={variantName}
            aria-label="Game variant"
            onChange={(e) => onVariantChange(e.target.value)}
          >
            {KNOWN_VARIANTS.map((id) => (
              <option key={id} value={id}>
                {VARIANT_META[id]?.label ?? id}
              </option>
            ))}
          </select>
          <p className="hint" style={{ margin: 0, flex: 1 }}>
            {meta.blurb}
          </p>
        </div>

        <h2>Muster players</h2>
        {cappedRows.map((row, i) => (
          <div className="player-row" key={i}>
            <input
              value={row.name}
              aria-label={`Player ${i + 1} name`}
              onChange={(e) => {
                const next = [...cappedRows]
                next[i] = { ...row, name: e.target.value }
                setRows(next)
              }}
            />
            <select
              value={row.kind}
              aria-label={`${row.name} type`}
              onChange={(e) => {
                const next = [...cappedRows]
                next[i] = { ...row, kind: e.target.value as PlayerKind }
                setRows(next)
              }}
            >
              <option value="human">Human</option>
              <option value="ai">AI</option>
            </select>
            {row.kind === 'ai' ? (
              <select
                value={row.aiProfileId}
                title="AI personality"
                aria-label={`${row.name} AI personality`}
                onChange={(e) => {
                  const next = [...cappedRows]
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
            ) : (
              <span className="player-row-spacer" aria-hidden="true" />
            )}
            <select
              value={row.colorId}
              aria-label={`${row.name} color`}
              onChange={(e) => {
                const next = [...cappedRows]
                next[i] = { ...row, colorId: e.target.value }
                setRows(next)
              }}
            >
              {PLAYER_COLORS.slice(0, Math.max(6, maxPlayers)).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <MarkerChit
              markerId={`${PLAYER_COLORS.find((c) => c.id === row.colorId)?.shortName ?? 'Rd'}01`}
              size={28}
            />
            {cappedRows.length > 2 && (
              <button
                type="button"
                className="ghost"
                onClick={() => setRows(cappedRows.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <div className="setup-actions">
          <button
            type="button"
            className="ghost"
            onClick={add}
            disabled={cappedRows.length >= maxPlayers}
          >
            Add player
          </button>
          <button
            type="button"
            className="primary"
            onClick={() =>
              onStart({
                variantName,
                players: cappedRows.map((r) => ({
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
