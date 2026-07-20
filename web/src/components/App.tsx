import { useCallback, useEffect, useState } from 'react'
import { isAiActing, pickAiCommand } from '../ai/simpleAi'
import { createGame, dispatch as engDispatch, getMovesForSelected } from '../engine/GameEngine'
import type { GameCommand, GameState, NewGameOptions } from '../engine/types'
import {
  loadGameFromLocalStorage,
  peekSavedGameMeta,
  saveGameToLocalStorage,
  type SavedGameMeta,
} from '../persistence/saveGame'
import { loadAssetManifest } from '../variant/assets'
import { loadDefaultVariant } from '../variant/loadVariant'
import { BattleBoardView } from './BattleBoardView'
import { GameControls } from './GameControls'
import { MasterBoardView } from './MasterBoardView'
import { SetupScreen } from './SetupScreen'

export type AiSpeedId = 'paused' | 'slow' | 'normal' | 'fast' | 'instant'

const AI_SPEEDS: Record<
  AiSpeedId,
  { label: string; delayMs: number | null; batch: number }
> = {
  paused: { label: 'Paused', delayMs: null, batch: 0 },
  slow: { label: 'Slow', delayMs: 750, batch: 1 },
  normal: { label: 'Normal', delayMs: 300, batch: 1 },
  fast: { label: 'Fast', delayMs: 90, batch: 1 },
  instant: { label: 'Instant', delayMs: 0, batch: 20 },
}

function stepAi(state: GameState, batch: number): GameState {
  let s = state
  for (let i = 0; i < batch; i++) {
    if (!isAiActing(s)) break
    const cmd = pickAiCommand(s)
    if (!cmd) break
    s = engDispatch(s, cmd)
  }
  return s
}

export default function App() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<GameState | null>(null)
  const [saveMeta, setSaveMeta] = useState<SavedGameMeta | null>(null)
  const [saveFlash, setSaveFlash] = useState<string | null>(null)
  const [aiSpeed, setAiSpeed] = useState<AiSpeedId>('normal')

  useEffect(() => {
    Promise.all([loadDefaultVariant(), loadAssetManifest()])
      .then(() => {
        setSaveMeta(peekSavedGameMeta())
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
  }, [])

  const start = useCallback(async (options: NewGameOptions) => {
    const variant = await loadDefaultVariant()
    const g = createGame(variant, options)
    setState(g)
    setSaveFlash(null)
    // All-AI: keep visible pace; with humans, Normal is fine for opponent turns
    const allAi = options.players.every((p) => p.kind === 'ai')
    setAiSpeed(allAi ? 'normal' : 'fast')
  }, [])

  const continueSaved = useCallback(async () => {
    const variant = await loadDefaultVariant()
    const loaded = loadGameFromLocalStorage(variant)
    if (!loaded) {
      setSaveMeta(null)
      return
    }
    setState(loaded)
    setSaveFlash(null)
  }, [])

  const save = useCallback(() => {
    if (!state) return
    saveGameToLocalStorage(state)
    setSaveMeta(peekSavedGameMeta())
    setSaveFlash('Saved')
  }, [state])

  useEffect(() => {
    if (!saveFlash) return
    const t = window.setTimeout(() => setSaveFlash(null), 1800)
    return () => window.clearTimeout(t)
  }, [saveFlash])

  // Keep localStorage in sync so a refresh can Continue
  useEffect(() => {
    if (!state) return
    saveGameToLocalStorage(state)
    setSaveMeta(peekSavedGameMeta())
  }, [state])

  // Paced AI autoplay — one (or a small batch) of commands at a time so the board updates
  useEffect(() => {
    if (!state) return
    if (state.winnerId || state.draw) return
    if (!isAiActing(state)) return
    const cfg = AI_SPEEDS[aiSpeed]
    if (cfg.delayMs == null || cfg.batch <= 0) return

    const id = window.setTimeout(() => {
      setState((prev) => {
        if (!prev || !isAiActing(prev)) return prev
        return stepAi(prev, cfg.batch)
      })
    }, cfg.delayMs)
    return () => window.clearTimeout(id)
  }, [state, aiSpeed])

  const apply = useCallback((cmd: GameCommand) => {
    setState((prev) => {
      if (!prev) return prev
      // Human command only — AI continues via the paced effect
      return engDispatch(prev, cmd)
    })
  }, [])

  const stepOnce = useCallback(() => {
    setState((prev) => {
      if (!prev || !isAiActing(prev)) return prev
      return stepAi(prev, 1)
    })
  }, [])

  const onHexClick = (label: string) => {
    if (!state || isAiActing(state)) return
    if (state.battle && !state.battle.done) {
      const battle = state.battle
      if (battle.phase === 'Move' && battle.selectedUnitId) {
        apply({ type: 'battleMove', unitId: battle.selectedUnitId, toHex: label })
      }
      return
    }
    if (state.phase === 'Move' && state.selectedLegionId) {
      const moves = getMovesForSelected(state)
      const info = moves.get(label)
      if (info) {
        apply({
          type: 'move',
          legionId: state.selectedLegionId,
          toHex: label,
          teleport: info.teleport,
        })
      }
    }
  }

  const onLegionClick = (legionId: string) => {
    if (!state || isAiActing(state)) return
    apply({ type: 'selectLegion', legionId })
  }

  const onBattleHex = (hex: string) => {
    if (!state?.battle?.selectedUnitId || isAiActing(state)) return
    if (state.battle.phase === 'Move') {
      apply({ type: 'battleMove', unitId: state.battle.selectedUnitId, toHex: hex })
    }
  }

  const onBattleUnit = (unitId: string) => {
    if (!state?.battle || isAiActing(state)) return
    const battle = state.battle
    if (battle.phase === 'Strike' || battle.phase === 'Strikeback') {
      if (battle.selectedUnitId && battle.highlighted.includes(unitId)) {
        apply({
          type: 'battleStrike',
          attackerId: battle.selectedUnitId,
          defenderId: unitId,
        })
        return
      }
    }
    apply({ type: 'battleSelectUnit', unitId })
  }

  if (loading) return <div className="boot">Loading Default variant…</div>
  if (error && !state) return <div className="boot error">Error: {error}</div>
  if (!state) {
    return (
      <SetupScreen
        onStart={start}
        onContinue={saveMeta ? continueSaved : undefined}
        savedGame={saveMeta}
      />
    )
  }

  const aiActing = isAiActing(state)
  const gameOver = Boolean(state.winnerId || state.draw)

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand-inline">Colossus</span>
        <span className="muted">Default · local</span>
        {state.winnerId && (
          <span className="winner">
            {state.players.find((p) => p.id === state.winnerId)?.name} wins!
          </span>
        )}
        {state.draw && <span className="winner">Draw!</span>}
        <span className="topbar-spacer" />
        {saveFlash && <span className="save-flash">{saveFlash}</span>}
        {!gameOver && (
          <label className="ai-speed">
            <span className="muted">AI speed</span>
            <select
              value={aiSpeed}
              aria-label="AI playback speed"
              onChange={(e) => setAiSpeed(e.target.value as AiSpeedId)}
            >
              {(Object.keys(AI_SPEEDS) as AiSpeedId[]).map((id) => (
                <option key={id} value={id}>
                  {AI_SPEEDS[id].label}
                </option>
              ))}
            </select>
          </label>
        )}
        {aiActing && aiSpeed === 'paused' && (
          <button type="button" className="ghost" onClick={stepOnce}>
            Step AI
          </button>
        )}
        <button type="button" className="ghost" onClick={save}>
          Save
        </button>
        <button type="button" className="ghost" onClick={() => setState(null)}>
          New game
        </button>
      </header>
      <main className="play">
        <div className="board-pane">
          {state.battle && !state.battle.done ? (
            <BattleBoardView
              state={state}
              battle={state.battle}
              onHexClick={onBattleHex}
              onUnitClick={onBattleUnit}
            />
          ) : (
            <MasterBoardView
              state={state}
              onHexClick={onHexClick}
              onLegionClick={onLegionClick}
            />
          )}
        </div>
        <GameControls state={state} dispatch={apply} interactive={!aiActing} />
      </main>
    </div>
  )
}
