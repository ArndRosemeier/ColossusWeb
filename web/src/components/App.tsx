import { useCallback, useEffect, useState } from 'react'
import { runAiUntilHuman } from '../ai/simpleAi'
import { createGame, dispatch as engDispatch, getMovesForSelected } from '../engine/GameEngine'
import type { GameCommand, GameState, NewGameOptions } from '../engine/types'
import { loadAssetManifest } from '../variant/assets'
import { loadDefaultVariant } from '../variant/loadVariant'
import { BattleBoardView } from './BattleBoardView'
import { GameControls } from './GameControls'
import { MasterBoardView } from './MasterBoardView'
import { SetupScreen } from './SetupScreen'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<GameState | null>(null)

  useEffect(() => {
    Promise.all([loadDefaultVariant(), loadAssetManifest()])
      .then(() => setLoading(false))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
  }, [])

  const start = useCallback(async (options: NewGameOptions) => {
    const variant = await loadDefaultVariant()
    let g = createGame(variant, options)
    g = runAiUntilHuman(g)
    setState(g)
  }, [])

  const apply = useCallback((cmd: GameCommand) => {
    setState((prev) => {
      if (!prev) return prev
      let next = engDispatch(prev, cmd)
      next = runAiUntilHuman(next)
      return next
    })
  }, [])

  const onHexClick = (label: string) => {
    if (!state) return
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
    apply({ type: 'selectLegion', legionId })
  }

  const onBattleHex = (hex: string) => {
    if (!state?.battle?.selectedUnitId) return
    if (state.battle.phase === 'Move') {
      apply({ type: 'battleMove', unitId: state.battle.selectedUnitId, toHex: hex })
    }
  }

  const onBattleUnit = (unitId: string) => {
    if (!state?.battle) return
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
  if (error) return <div className="boot error">Error: {error}</div>
  if (!state) return <SetupScreen onStart={start} />

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand-inline">Colossus</span>
        <span className="muted">Default variant · local play</span>
        {state.winnerId && (
          <span className="winner">
            {state.players.find((p) => p.id === state.winnerId)?.name} wins!
          </span>
        )}
        {state.draw && <span className="winner">Draw!</span>}
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
        <GameControls state={state} dispatch={apply} />
      </main>
    </div>
  )
}
