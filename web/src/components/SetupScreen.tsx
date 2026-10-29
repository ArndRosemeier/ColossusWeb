import { useMemo, useState } from 'react'
import { WhatsNewButton } from './WhatsNew'
import type { AiProfileId } from '../ai/profiles'
import { AI_PROFILE_CHOICES } from '../ai/profiles'
import type { NewGameOptions, PlayerKind } from '../engine/types'
import { PLAYER_COLORS } from '../engine/types'
import type { CuedPlayer } from '../net/cuedPlayer'
import type { LocalPlayer } from '../net/identity'
import type { HubSession } from '../net/session'
import type { SavedGameMeta } from '../persistence/saveGame'
import { KNOWN_VARIANTS } from '../variant/loadVariant'
import { PresentationModeToggle } from './PresentationModeToggle'
import { BackgroundAtmosphereSelect } from './BackgroundAtmosphere'
import { CuedBadge } from './CuedBadge'
import { LobbyPanel } from './LobbyPanel'
import { MarkerChit } from './MarkerChit'
import './setup.css'

interface Props {
  onStart: (options: NewGameOptions) => void
  /** The ONE online connection (owned by `App`, so it outlives this screen). */
  session: HubSession
  /** The cued.de player, if the game was opened from cued. */
  cued: CuedPlayer
  player: LocalPlayer
  onPlayerChange: (player: LocalPlayer) => void
  /** Open the online game this browser is in (the host starts it first). */
  onOnlineEnter: () => void
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

export function SetupScreen({
  onStart,
  session,
  cued,
  player,
  onPlayerChange,
  onOnlineEnter,
  onContinue,
  savedGame,
}: Props) {
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
      <header className="setup-nav">
        <a className="setup-wordmark" href="#title-screen" aria-label="Colossus title screen">Colossus</a>
        <nav className="setup-nav-actions" aria-label="Title screen navigation">
          <a className="setup-nav-link" href="#local-setup">Local game</a>
          <a className="setup-nav-link" href="#online-lobby">Online play</a>
          <div className="setup-preferences">
            <PresentationModeToggle />
            <WhatsNewButton compact />
          </div>
          <CuedBadge cued={cued} compact />
        </nav>
      </header>

      <main id="title-screen">
        <section className="setup-hero" aria-labelledby="setup-title">
          <img className="setup-hero-art" src={`${import.meta.env.BASE_URL}title-screen/colossus-landscape-v1.png`}
            alt="" aria-hidden="true" fetchPriority="high" decoding="async" />
          <div className="setup-hero-shade" aria-hidden="true" />
          <div className="setup-hero-copy">
            <p className="setup-eyebrow">Fantasy strategy · Titan</p>
            <h1 id="setup-title">Raise your legion.<br /><span>Claim the board.</span></h1>
            <p className="setup-hero-description">
              Build an army of mythical creatures. Split your legions, choose your ground,
              and bring rival Titans to battle.
            </p>
            <div className="setup-hero-actions">
              <a className="setup-primary-action" href="#local-setup">Set up a campaign <span aria-hidden="true">→</span></a>
              <a className="setup-secondary-action" href="#online-lobby">Play online <span aria-hidden="true">↗</span></a>
            </div>
            <p className="setup-hero-note">Hotseat, AI opponents, or a shared board with friends.</p>
          </div>
        </section>

        {savedGame && onContinue && (
          <section className="setup-resume" aria-label="Continue saved game">
            <div className="setup-resume-copy">
              <p className="setup-eyebrow">Awaiting your return</p>
              <h2>Continue your campaign</h2>
              <p className="setup-resume-meta">
                {savedGame.variantName} · Turn {savedGame.turnNumber} · {savedGame.phase}
                <span>{savedGame.players}</span>
              </p>
            </div>
            <div className="setup-resume-action">
              <span>Saved {formatSavedAt(savedGame.savedAt)}</span>
              <button type="button" className="primary" onClick={onContinue}>Load saved game</button>
            </div>
          </section>
        )}

        <div className="setup-workbench">
          <section id="local-setup" className="campaign-panel" aria-labelledby="campaign-title" tabIndex={-1}>
            <div className="setup-panel-heading">
              <div>
                <p className="setup-eyebrow">Gather at the table</p>
                <h2 id="campaign-title">Set up a campaign</h2>
                <p>Play locally with friends and AI opponents.</p>
              </div>
              <span className="setup-player-count">{cappedRows.length} / {maxPlayers} players</span>
            </div>

            <div className="setup-variant">
              <label htmlFor="setup-variant">Choose your battlefield</label>
              <select id="setup-variant" value={variantName} aria-label="Game variant"
                onChange={(e) => onVariantChange(e.target.value)}>
                {KNOWN_VARIANTS.map((id) => (
                  <option key={id} value={id}>{VARIANT_META[id]?.label ?? id}</option>
                ))}
              </select>
              <p>{meta.blurb}</p>
            </div>

            <div className="setup-commanders-heading">
              <h3>Your commanders</h3>
              <span>Choose a name, a color, and a rival.</span>
            </div>
            <div className="setup-commanders">
              {cappedRows.map((row, i) => (
                <fieldset className="setup-player-row" key={i}>
                  <legend>Commander {String(i + 1).padStart(2, '0')}</legend>
                  <div className="setup-player-fields">
                    <div className="setup-player-marker">
                      <MarkerChit
                        markerId={`${PLAYER_COLORS.find((c) => c.id === row.colorId)?.shortName ?? 'Rd'}01`}
                        color={PLAYER_COLORS.find((c) => c.id === row.colorId)?.css}
                        size={28}
                      />
                    </div>
                    <label className="setup-player-name">
                      <span>Name</span>
                      <input value={row.name} aria-label={`Player ${i + 1} name`}
                        onChange={(e) => {
                          const next = [...cappedRows]
                          next[i] = { ...row, name: e.target.value }
                          setRows(next)
                        }} />
                    </label>
                    <label className="setup-player-kind">
                      <span>Control</span>
                      <select value={row.kind} aria-label={`${row.name} type`}
                        onChange={(e) => {
                          const next = [...cappedRows]
                          next[i] = { ...row, kind: e.target.value as PlayerKind }
                          setRows(next)
                        }}>
                        <option value="human">Human</option>
                        <option value="ai">AI</option>
                      </select>
                    </label>
                    {row.kind === 'ai' ? (
                      <label className="setup-player-personality">
                        <span>Personality</span>
                        <select value={row.aiProfileId} title="AI personality" aria-label={`${row.name} AI personality`}
                          onChange={(e) => {
                            const next = [...cappedRows]
                            next[i] = { ...row, aiProfileId: e.target.value as AiProfileId }
                            setRows(next)
                          }}>
                          {AI_PROFILE_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </label>
                    ) : (
                      <div className="setup-player-personality setup-human-note"><span>Personality</span><p>You decide</p></div>
                    )}
                    <label className="setup-player-color">
                      <span>Color</span>
                      <select value={row.colorId} aria-label={`${row.name} color`}
                        onChange={(e) => {
                          const next = [...cappedRows]
                          next[i] = { ...row, colorId: e.target.value }
                          setRows(next)
                        }}>
                        {PLAYER_COLORS.slice(0, Math.max(6, maxPlayers)).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </label>
                    {cappedRows.length > 2 && (
                      <button type="button" className="ghost setup-remove" aria-label={`Remove ${row.name}`}
                        onClick={() => setRows(cappedRows.filter((_, j) => j !== i))}>Remove</button>
                    )}
                  </div>
                </fieldset>
              ))}
            </div>
            <div className="campaign-actions">
              <button type="button" className="ghost" onClick={add} disabled={cappedRows.length >= maxPlayers}>
                <span aria-hidden="true">+</span> Add player
              </button>
              <button type="button" className="primary setup-begin"
                onClick={() => onStart({
                  variantName,
                  players: cappedRows.map((r) => ({
                    name: r.name,
                    kind: r.kind,
                    colorId: r.colorId,
                    aiProfileId: r.kind === 'ai' ? r.aiProfileId : undefined,
                  })),
                })}>
                Begin campaign <span aria-hidden="true">→</span>
              </button>
            </div>
          </section>

          <aside id="online-lobby" className="setup-online" aria-label="Online play" tabIndex={-1}>
            <LobbyPanel session={session} cued={cued} player={player} onPlayerChange={onPlayerChange}
              variantName={variantName} maxPlayers={maxPlayers} onEnter={onOnlineEnter} />
          </aside>
        </div>

        <details className="setup-appearance">
          <summary><span>Appearance</span><span className="setup-appearance-hint">Make the war table yours</span></summary>
          <div className="setup-appearance-controls">
            <BackgroundAtmosphereSelect showBlurb className="bg-atmosphere-select setup-bg" />
          </div>
        </details>
      </main>
      <footer className="setup-footer"><span>Colossus</span><p>A browser adaptation of Titan.</p><a href="#title-screen">Back to top ↑</a></footer>
    </div>
  )
}
