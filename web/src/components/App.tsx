import { useCallback, useEffect, useRef, useState } from 'react'
import { isAiActing, pickAiCommand } from '../ai/simpleAi'
import { createGame, dispatch as engDispatch, getMovesForSelected, activePlayer } from '../engine/GameEngine'
import { battleLand } from '../engine/battle'
import { listStrikeRaiseOptions } from '../engine/battleStrike'
import type { GameCommand, GameState, NewGameOptions } from '../engine/types'
import {
  loadGameFromLocalStorage,
  peekSavedGameMeta,
  saveGameToLocalStorage,
  type SavedGameMeta,
} from '../persistence/saveGame'
import { AI_SPEEDS, type AiSpeedId } from '../ui/aiSpeed'
import {
  buildMoveAnim,
  isMoveCommand,
  shouldSkipMoveAnim,
  type MoveAnim,
} from '../ui/moveAnimation'
import { loadAssetManifest } from '../variant/assets'
import { loadDefaultVariant } from '../variant/loadVariant'
import { BattleBoardView } from './BattleBoardView'
import { DiceOverlay, shouldAnimateDice } from './DiceOverlay'
import { GameControls, type PendingStrikeAnnounce } from './GameControls'
import { phaseEndCommand, applyEnterKeyPhaseEnd } from './LegionActions'
import { MasterBoardView } from './MasterBoardView'
import { SetupScreen } from './SetupScreen'

export type { AiSpeedId }

function stepAi(state: GameState, batch: number): GameState {
  let s = state
  for (let i = 0; i < batch; i++) {
    if (!isAiActing(s)) break
    // Instant / batch AI: resolve any pending physical roll via rng
    while (s.pendingDice) {
      s = engDispatch(s, { type: 'commitDice' })
    }
    if (!isAiActing(s)) break
    const cmd = pickAiCommand(s)
    if (!cmd) break
    s = engDispatch(s, cmd)
  }
  while (s.pendingDice) {
    s = engDispatch(s, { type: 'commitDice' })
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
  const [moveAnim, setMoveAnim] = useState<MoveAnim | null>(null)
  const [pendingStrike, setPendingStrike] = useState<PendingStrikeAnnounce | null>(null)
  const pendingCmdRef = useRef<GameCommand | null>(null)
  const animatingRef = useRef(false)

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
    const g = createGame(variant, { ...options, diceMode: 'physical' })
    setState(g)
    setSaveFlash(null)
    setMoveAnim(null)
    setPendingStrike(null)
    pendingCmdRef.current = null
    animatingRef.current = false
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
    // Resume in the UI with physical dice; clear any mid-throw pending
    loaded.diceMode = 'physical'
    if (loaded.pendingDice) {
      const resumed = engDispatch(loaded, { type: 'commitDice' })
      setState(resumed)
    } else {
      setState(loaded)
    }
    setSaveFlash(null)
    setMoveAnim(null)
    setPendingStrike(null)
    pendingCmdRef.current = null
    animatingRef.current = false
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

  // Autosave — skip while dice are in the air so localStorage I/O can't stall the throw
  useEffect(() => {
    if (!state) return
    if (state.pendingDice) return
    const t = window.setTimeout(() => {
      saveGameToLocalStorage(state)
      setSaveMeta(peekSavedGameMeta())
    }, 0)
    return () => window.clearTimeout(t)
  }, [state])

  const onMoveAnimDone = useCallback(() => {
    const cmd = pendingCmdRef.current
    pendingCmdRef.current = null
    animatingRef.current = false
    setMoveAnim(null)
    if (!cmd) return
    setState((prev) => (prev ? engDispatch(prev, cmd) : prev))
  }, [])

  const onDiceThrowDone = useCallback((values: number[] | undefined) => {
    setState((prev) => {
      if (!prev?.pendingDice) return prev
      return engDispatch(prev, { type: 'commitDice', values })
    })
  }, [])

  const apply = useCallback(
    (cmd: GameCommand, forAi = false) => {
      if (animatingRef.current) return
      setPendingStrike(null)
      setState((prev) => {
        if (!prev) return prev
        if (prev.pendingDice) return prev
        if (isMoveCommand(cmd) && !shouldSkipMoveAnim(aiSpeed, forAi)) {
          const anim = buildMoveAnim(prev, cmd, { aiSpeed, forAi })
          if (anim) {
            animatingRef.current = true
            pendingCmdRef.current = cmd
            queueMicrotask(() => setMoveAnim(anim))
            return prev
          }
        }
        let next = engDispatch(prev, cmd)
        // Instant AI / reduced-motion: resolve without a visible throw
        if (next.pendingDice && !shouldAnimateDice(aiSpeed, forAi)) {
          while (next.pendingDice) {
            next = engDispatch(next, { type: 'commitDice' })
          }
        }
        return next
      })
    },
    [aiSpeed],
  )

  // Paced AI autoplay — blocked while a physical throw is pending
  useEffect(() => {
    if (!state) return
    if (moveAnim || animatingRef.current) return
    if (state.pendingDice) return
    if (state.winnerId || state.draw) return
    if (!isAiActing(state)) return
    const cfg = AI_SPEEDS[aiSpeed]
    if (cfg.delayMs == null || cfg.batch <= 0) return

    const id = window.setTimeout(() => {
      if (aiSpeed === 'instant' || cfg.batch > 1) {
        setState((prev) => {
          if (!prev || !isAiActing(prev)) return prev
          return stepAi(prev, cfg.batch)
        })
        return
      }
      setState((prev) => {
        if (!prev || !isAiActing(prev) || animatingRef.current) return prev
        if (prev.pendingDice) return prev
        const cmd = pickAiCommand(prev)
        if (!cmd) return prev
        if (isMoveCommand(cmd) && !shouldSkipMoveAnim(aiSpeed, true)) {
          const anim = buildMoveAnim(prev, cmd, { aiSpeed, forAi: true })
          if (anim) {
            animatingRef.current = true
            pendingCmdRef.current = cmd
            queueMicrotask(() => setMoveAnim(anim))
            return prev
          }
        }
        let next = engDispatch(prev, cmd)
        if (next.pendingDice && !shouldAnimateDice(aiSpeed, true)) {
          while (next.pendingDice) {
            next = engDispatch(next, { type: 'commitDice' })
          }
        }
        return next
      })
    }, cfg.delayMs)
    return () => window.clearTimeout(id)
  }, [state, aiSpeed, moveAnim])

  const stepOnce = useCallback(() => {
    if (animatingRef.current) return
    setState((prev) => {
      if (!prev || !isAiActing(prev)) return prev
      if (prev.pendingDice) return prev
      const cmd = pickAiCommand(prev)
      if (!cmd) return prev
      if (isMoveCommand(cmd) && !shouldSkipMoveAnim(aiSpeed, true)) {
        const anim = buildMoveAnim(prev, cmd, { aiSpeed, forAi: true })
        if (anim) {
          animatingRef.current = true
          pendingCmdRef.current = cmd
          queueMicrotask(() => setMoveAnim(anim))
          return prev
        }
      }
      let next = engDispatch(prev, cmd)
      if (next.pendingDice && !shouldAnimateDice(aiSpeed, true)) {
        while (next.pendingDice) {
          next = engDispatch(next, { type: 'commitDice' })
        }
      }
      return next
    })
  }, [aiSpeed])

  const busy = Boolean(moveAnim) || animatingRef.current || Boolean(state?.pendingDice)

  const onHexClick = (label: string) => {
    if (!state || isAiActing(state) || busy) return
    if (state.pendingDice) return
    if (state.battle && !state.battle.done) {
      const battle = state.battle
      if (battle.phase === 'Move' && battle.selectedUnitId) {
        apply({ type: 'battleMove', unitId: battle.selectedUnitId, toHex: label })
      }
      return
    }
    // Clicking the board dismisses split/muster overlay
    if (
      (state.phase === 'Split' || state.phase === 'Muster') &&
      state.selectedLegionId
    ) {
      apply({ type: 'deselectLegion' })
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
      } else {
        apply({ type: 'deselectLegion' })
      }
    }
  }

  const onLegionClick = (legionId: string) => {
    if (!state || busy) return
    // Toggle off when re-clicking the selected legion during split/muster
    if (
      state.selectedLegionId === legionId &&
      (state.phase === 'Split' || state.phase === 'Muster')
    ) {
      apply({ type: 'deselectLegion' })
      return
    }
    // Colossus spin cycle: second click on the selected mover ends on the start hex
    // when an exact-roll loop is legal (tower-adjacent brush, swamp/desert on a 6, etc.).
    if (
      state.phase === 'Move' &&
      state.selectedLegionId === legionId &&
      !isAiActing(state)
    ) {
      const legion = state.legions.find((l) => l.id === legionId)
      if (legion && legion.playerId === activePlayer(state).id) {
        const moves = getMovesForSelected(state)
        const info = moves.get(legion.hexLabel)
        if (info && !info.teleport) {
          apply({
            type: 'move',
            legionId,
            toHex: legion.hexLabel,
            teleport: false,
          })
          return
        }
      }
    }
    // Inspection allowed even while AI acts (public knowledge / own stacks)
    apply({ type: 'selectLegion', legionId })
  }

  const onBattleHex = (hex: string) => {
    if (!state?.battle?.selectedUnitId || isAiActing(state) || busy) return
    if (state.battle.phase === 'Move') {
      apply({ type: 'battleMove', unitId: state.battle.selectedUnitId, toHex: hex })
    }
  }

  const onBattleUnit = (unitId: string) => {
    if (!state?.battle || isAiActing(state) || busy) return
    const battle = state.battle
    if (battle.phase === 'Strike' || battle.phase === 'Strikeback') {
      if (battle.selectedUnitId && battle.highlighted.includes(unitId)) {
        const attacker = battle.units.find((u) => u.id === battle.selectedUnitId)
        const defender = battle.units.find((u) => u.id === unitId)
        if (attacker && defender) {
          const land = battleLand(state, battle)
          const { options } = listStrikeRaiseOptions(state, battle, land, attacker, defender)
          if (options.length > 0) {
            setPendingStrike({ attackerId: attacker.id, defenderId: defender.id })
            return
          }
        }
        apply({
          type: 'battleStrike',
          attackerId: battle.selectedUnitId,
          defenderId: unitId,
        })
        return
      }
    }
    setPendingStrike(null)
    apply({ type: 'battleSelectUnit', unitId })
  }

  const aiActing = state ? isAiActing(state) : false
  const gameOver = Boolean(state?.winnerId || state?.draw)
  const interactive = Boolean(state) && !aiActing && !busy && !gameOver

  useEffect(() => {
    if (!interactive || !state) return
    const onKeyDown = (e: KeyboardEvent) => {
      const isSpace = e.code === 'Space' || e.key === ' '
      const isEnter = e.code === 'Enter' || e.key === 'Enter'
      if (!isSpace && !isEnter) return
      if (e.repeat) return
      if (pendingStrike) {
        if (isSpace || isEnter) {
          e.preventDefault()
          setPendingStrike(null)
        }
        return
      }
      const target = e.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          tag === 'BUTTON' ||
          tag === 'A' ||
          target.isContentEditable ||
          target.closest('button, a, [role="button"]')
        ) {
          return
        }
      }
      if (isEnter) {
        e.preventDefault()
        setState((prev) => {
          if (!prev || animatingRef.current || prev.pendingDice) return prev
          return applyEnterKeyPhaseEnd(prev)
        })
        return
      }
      const cmd = phaseEndCommand(state)
      if (!cmd) return
      e.preventDefault()
      apply(cmd)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [interactive, state, apply, pendingStrike])

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

  const masterAnim = moveAnim?.board === 'master' ? moveAnim : null
  const battleAnim = moveAnim?.board === 'battle' ? moveAnim : null
  const throwerId = state.pendingDice?.playerId ?? state.diceRoll?.playerId
  const seatIndex = throwerId
    ? Math.max(0, state.players.findIndex((p) => p.id === throwerId))
    : 0
  const seatCount = state.players.length

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
          <button type="button" className="ghost" onClick={stepOnce} disabled={busy}>
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
              moveAnim={battleAnim}
              onMoveAnimDone={onMoveAnimDone}
            />
          ) : (
            <MasterBoardView
              state={state}
              onHexClick={onHexClick}
              onLegionClick={onLegionClick}
              moveAnim={masterAnim}
              onMoveAnimDone={onMoveAnimDone}
              dispatch={apply}
              interactive={interactive}
            />
          )}
          <DiceOverlay
            pending={state.pendingDice}
            settled={state.diceRoll}
            seatIndex={seatIndex}
            seatCount={seatCount}
            animate={shouldAnimateDice(aiSpeed, aiActing)}
            onThrowDone={onDiceThrowDone}
          />
        </div>
        <GameControls
          state={state}
          dispatch={apply}
          interactive={interactive}
          pendingStrike={pendingStrike}
          onCancelPendingStrike={() => setPendingStrike(null)}
        />
      </main>
    </div>
  )
}
