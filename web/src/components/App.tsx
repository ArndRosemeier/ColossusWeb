import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAiActing, pickAiCommand } from '../ai/simpleAi'
import {
  activePlayer,
  createGame,
  dispatch as engDispatch,
  getMovesForSelected,
} from '../engine/GameEngine'
import { battleLand } from '../engine/battle'
import { listStrikeRaiseOptions } from '../engine/battleStrike'
import type { GameCommand, GameState, NewGameOptions } from '../engine/types'
import { forgetActiveGame, rememberActiveGame } from '../net/activeGame'
import type { FailureDescription } from '../net/failure'
import { seatIndexOf } from '../net/gameRecord'
import { createServerStoreTransport } from '../net/serverStore'
import {
  actingPlayerId,
  adopt,
  assertHumanSeats,
  createCommitPath,
  createSyncSession,
  fetchLatest,
  isMyTurn,
  multiplayerSeatOptions,
  pollLatest,
  usePolledStatus,
  type CommitPath,
  type MultiplayerHandoff,
  type PollHandle,
  type PollStatus,
  type SyncSession,
} from '../net/sync'
import {
  loadGameFromLocalStorage,
  peekSavedGameMeta,
  saveGameToLocalStorage,
  type SavedGameMeta,
} from '../persistence/saveGame'
import {
  boardBlockedReason,
  boardClickVerdict,
  type BoardGate,
} from '../ui/boardInteraction'
import { AI_SPEEDS, type AiSpeedId } from '../ui/aiSpeed'
import {
  buildMoveAnim,
  isMoveCommand,
  shouldSkipMoveAnim,
  type MoveAnim,
} from '../ui/moveAnimation'
import { loadAssetManifest } from '../variant/assets'
import { loadVariant, type LoadedVariant } from '../variant/loadVariant'
import { BattleBoardView } from './BattleBoardView'
import {
  BoardDecisionOverlay,
  type PendingStrikeAnnounce,
} from './BoardDecisionOverlay'
import { DiceOverlay, shouldAnimateDice } from './DiceOverlay'
import { GameControls } from './GameControls'
import { phaseEndCommand, applyEnterKeyPhaseEnd } from './LegionActions'
import { MasterBoardView } from './MasterBoardView'
import { BackgroundAtmosphereSelect } from './BackgroundAtmosphere'
import { MultiplayerStatus } from './MultiplayerStatus'
import { SetupScreen } from './SetupScreen'

export type { AiSpeedId }

/** The open multiplayer game, as the UI needs it. */
interface MultiplayerSeatInfo {
  readonly gameId: string
  /** This client's seat index, or -1 for a spectator. */
  readonly seat: number
  readonly seatCount: number
}

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
  const [multiplayer, setMultiplayer] = useState<MultiplayerSeatInfo | null>(null)
  const [syncFailureState, setSyncFailureState] = useState<FailureDescription | null>(null)
  const pendingCmdRef = useRef<GameCommand | null>(null)
  const animatingRef = useRef(false)
  /** The game state as of NOW, so a command never acts on a stale render. */
  const stateRef = useRef<GameState | null>(null)
  const variantRef = useRef<LoadedVariant | null>(null)
  const sessionRef = useRef<SyncSession | null>(null)
  const pollRef = useRef<PollHandle | null>(null)

  /**
   * The ONE writer of the game state. Everything — a local command, an adopted
   * snapshot, a new or resumed game, "New game" — goes through here, and the
   * single commit path below is the only caller that can also publish.
   */
  const putState = useCallback((next: GameState | null) => {
    stateRef.current = next
    setState(next)
  }, [])

  /**
   * THE commit path. Every local reducer runs through `commitPath.local`, which
   * both updates the state and publishes exactly one snapshot when a
   * multiplayer session is open; every remote snapshot runs through
   * `commitPath.remote`, which never publishes. There is no other way for this
   * component to change the game state — `setState` is reachable only through
   * `putState`, and `putState` only from here, `start`, `continueSaved` and
   * `startMultiplayer`.
   */
  const commitPath = useMemo<CommitPath>(
    () =>
      createCommitPath({
        getState: () => stateRef.current,
        setState: putState,
        getSession: () => sessionRef.current,
        onFailure: (failure) => setSyncFailureState(failure),
      }),
    [putState],
  )

  const stopSession = useCallback(() => {
    pollRef.current?.stop()
    pollRef.current = null
    sessionRef.current = null
    setMultiplayer(null)
    setSyncFailureState(null)
  }, [])

  /**
   * Start the session's poll loop for one open game — the SAME loop the lobby
   * runs (`sync.ts`'s `pollLoop`), here carrying the game's snapshot job at the
   * game's cadence. `pollLatest` is that job; nothing else in this component
   * owns a timer.
   *
   * The optional `report` is what `usePolledStatus` hands its starter: the poll's
   * own status goes into the hook's state through it, so the status line reads
   * ONE status from ONE loop.
   */
  const startGameLoop = useCallback(
    (session?: SyncSession, report?: (status: PollStatus) => void): PollHandle | null => {
      // The hook starts this component's app life with no session — there is
      // nothing to poll until `startMultiplayer` runs. A later call REPLACES the
      // loop rather than stacking a second one on it.
      if (session === undefined) return null
      pollRef.current?.stop()
      const handle = pollLatest(session, {
        onAdopt: (body) => {
          const current = variantRef.current
          if (current !== null) commitPath.remote(body, current)
        },
        onStatus: (status) => report?.(status),
      })
      pollRef.current = handle
      return handle
    },
    [commitPath],
  )

  // ONE loop for the whole session: this hook carries the loop's status into
  // React, and the unmount effect below stops whatever `startGameLoop` created.
  const polled = usePolledStatus((report) => startGameLoop(undefined, report))
  const syncStatus = polled.status
  // The failure the player sees: the loop's own last refusal, OR a publish that
  // failed on the commit path (`onFailure` above). Both are the app's ONE error
  // surface on the status line, and a later healthy poll does not erase a publish
  // refusal — that one is cleared by the next successful publish or a new game.
  const syncFailure = polled.failure ?? syncFailureState

  useEffect(() => {
    Promise.all([loadVariant('Default'), loadAssetManifest('Default')])
      .then(() => {
        setSaveMeta(peekSavedGameMeta())
        setLoading(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
  }, [])

  // Tear the poll loop down with the app: nothing outlives the component. (The
  // loop's own start/stop pair is `usePolledStatus` above; this is the unmount
  // half, which is why `startGameLoop` is the ONE place a loop is created.)
  useEffect(() => () => pollRef.current?.stop(), [])

  const start = useCallback(
    async (options: NewGameOptions) => {
      try {
        stopSession()
        const name = options.variantName ?? 'Default'
        const variant = await loadVariant(name)
        await loadAssetManifest(name)
        variantRef.current = variant
        const g = createGame(variant, { ...options, diceMode: 'physical' })
        putState(g)
        setSaveFlash(null)
        setMoveAnim(null)
        setPendingStrike(null)
        pendingCmdRef.current = null
        animatingRef.current = false
        const allAi = options.players.every((p) => p.kind === 'ai')
        setAiSpeed(allAi ? 'normal' : 'fast')
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [stopSession, putState],
  )

  /**
   * Open a started multiplayer game. The creator's client (`host`) publishes the
   * opening snapshot; everyone else's (`adopt`) reads the newest one FIRST and
   * only falls back to the freshly built board if the host has not published
   * yet. Both builds are identical (`multiplayerSeatOptions` seeds `createGame`
   * from the game id), so a fallback can never show a different position.
   */
  const startMultiplayer = useCallback(
    async (handoff: MultiplayerHandoff) => {
      try {
        stopSession()
        const name = handoff.record.variant
        const variant = await loadVariant(name)
        await loadAssetManifest(name)
        variantRef.current = variant

        const transport = createServerStoreTransport()
        const session = createSyncSession({
          transport,
          identity: handoff.identity,
          record: handoff.record,
        })
        sessionRef.current = session

        let initial: GameState | null = null
        if (handoff.mode === 'adopt') {
          const latest = await fetchLatest(transport, handoff.record.gameId, {
            store: session.store,
            heldName: null,
          })
          if (latest !== null) {
            initial = adopt(latest.body, null, variant)
            session.tracker.last = latest.body.header.name
            session.tracker.turn = latest.body.header.turn
            session.tracker.seq = latest.body.header.seq
          }
        }
        if (initial === null) {
          initial = createGame(variant, {
            ...multiplayerSeatOptions(handoff.record, handoff.players),
            variantName: name,
          })
        }
        // A multiplayer seat is a human holding a key. An AI seat here would be
        // driven by every client at once — refuse it loudly, never play it.
        assertHumanSeats(initial)

        setMultiplayer({
          gameId: handoff.record.gameId,
          seat: seatIndexOf(handoff.record, handoff.identity.id),
          seatCount: handoff.record.seatOrder.length,
        })
        rememberActiveGame(handoff.record.gameId)
        setSaveFlash(null)
        setMoveAnim(null)
        setPendingStrike(null)
        pendingCmdRef.current = null
        animatingRef.current = false
        setAiSpeed('fast')
        putState(initial)

        if (handoff.mode === 'host') commitPath.publishCurrent()
        startGameLoop(session)
      } catch (e: unknown) {
        stopSession()
        putState(null)
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [stopSession, putState, commitPath, startGameLoop],
  )

  const continueSaved = useCallback(async () => {
    stopSession()
    const meta = peekSavedGameMeta()
    const name = meta?.variantName ?? 'Default'
    const variant = await loadVariant(name)
    await loadAssetManifest(name)
    variantRef.current = variant
    const loaded = loadGameFromLocalStorage(variant)
    if (!loaded) {
      setSaveMeta(null)
      return
    }
    // Resume in the UI with physical dice; clear any mid-throw pending
    loaded.diceMode = 'physical'
    if (loaded.pendingDice) {
      putState(engDispatch(loaded, { type: 'commitDice' }))
    } else {
      putState(loaded)
    }
    setSaveFlash(null)
    setMoveAnim(null)
    setPendingStrike(null)
    pendingCmdRef.current = null
    animatingRef.current = false
  }, [stopSession, putState])

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
    commitPath.local((prev) => engDispatch(prev, cmd), cmd)
  }, [commitPath])

  const onDiceThrowDone = useCallback(
    (values: number[] | undefined) => {
      const cmd: GameCommand = { type: 'commitDice', values }
      commitPath.local((prev) => (prev.pendingDice ? engDispatch(prev, cmd) : prev), cmd)
    },
    [commitPath],
  )

  const apply = useCallback(
    (cmd: GameCommand, forAi = false) => {
      if (animatingRef.current) return
      setPendingStrike(null)
      commitPath.local((prev) => {
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
      }, cmd)
    },
    [aiSpeed, commitPath],
  )

  /**
   * The browser check's handle to the ONE commit path (`scripts/browser-check/
   * s8-engagement-choice.py`). It exists so the check can FIRE a command that no
   * button offers any more — the attacker's removed `proposeAgreement{fight}`
   * shortcut — and observe that the engine refuses it and the app publishes
   * nothing. Non-production bundles only (`vite build --mode test`), and it is
   * `apply` itself, so it cannot bypass the commit path's publish decision.
   */
  const browserCheckHandle = useCallback((cmd: GameCommand) => apply(cmd), [apply])
  useEffect(() => {
    if (import.meta.env.MODE === 'production') return
    const w = window as unknown as { __colossusDispatch?: (cmd: GameCommand) => void }
    w.__colossusDispatch = browserCheckHandle
    return () => {
      delete w.__colossusDispatch
    }
  }, [browserCheckHandle])

  const busy = Boolean(moveAnim) || animatingRef.current || Boolean(state?.pendingDice)
  const aiActing = state ? isAiActing(state) : false
  const gameOver = Boolean(state?.winnerId || state?.draw)
  /**
   * Turn authority. Hotseat has no seats, so the local player may always act.
   * In a multiplayer game only the seats `actingPlayerIds` names may act — the
   * active seat, both parties to an engagement, the battle step's owner, the
   * defender awaiting a post-battle reinforcement, or the thrower of a pending
   * physical roll. A spectator (seat -1) is read-only. The engine's own refusal
   * inside `applyCommand` is the backstop, not the mechanism.
   */
  const myPlayerId =
    multiplayer !== null && state !== null && multiplayer.seat >= 0
      ? (state.players[multiplayer.seat]?.id ?? null)
      : null
  const myTurn =
    multiplayer === null ? true : state !== null && myPlayerId !== null && isMyTurn(state, myPlayerId)
  const interactive = Boolean(state) && !aiActing && !busy && !gameOver && myTurn
  /**
   * THE board authority for this client: whether it may act, and what the ONE
   * message surface says when it may not. `interactive`, the painted fields
   * (`MasterBoardView` reads the same flag) and the click verdict all derive from
   * this ONE value, so "painted" and "accepted" cannot disagree (ledger row 13).
   */
  const boardGate: BoardGate =
    state === null
      ? { canAct: false, refusal: 'No game is open.' }
      : {
          canAct: interactive,
          refusal: gameOver
            ? 'The game is over.'
            : aiActing
              ? 'The AI is playing — wait for it to finish.'
              : busy
                ? 'A move is being played — wait for it to finish.'
                : boardBlockedReason(state, myPlayerId),
        }

  /**
   * The board's refusal, on the app's ONE message surface. It goes through the
   * ONE commit path with the local-only `notice` command, so it is visible,
   * never publishes a snapshot, and cannot silently change what is selected.
   */
  const notify = useCallback(
    (message: string) => {
      const cmd: GameCommand = { type: 'notice', message }
      commitPath.local((prev) => engDispatch(prev, cmd), cmd)
    },
    [commitPath],
  )

  // Paced AI autoplay — blocked while a physical throw is pending, and NEVER on
  // in a multiplayer game (those seats are human; a client-driven AI would
  // diverge from every other client).
  useEffect(() => {
    if (!state) return
    if (multiplayer !== null) return
    if (moveAnim || animatingRef.current) return
    if (state.pendingDice) return
    if (state.winnerId || state.draw) return
    if (!isAiActing(state)) return
    const cfg = AI_SPEEDS[aiSpeed]
    if (cfg.delayMs == null || cfg.batch <= 0) return

    const id = window.setTimeout(() => {
      if (aiSpeed === 'instant' || cfg.batch > 1) {
        commitPath.local((prev) => (prev && isAiActing(prev) ? stepAi(prev, cfg.batch) : prev))
        return
      }
      commitPath.local((prev) => {
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
  }, [state, aiSpeed, moveAnim, multiplayer, commitPath])

  const stepOnce = useCallback(() => {
    if (animatingRef.current) return
    commitPath.local((prev) => {
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
  }, [aiSpeed, commitPath])

  const onHexClick = (label: string) => {
    if (!state) return
    // A click this client may not act on is REFUSED, loudly — never a silent
    // deselect (ledger row 13, AGENTS.md rule 1).
    if (!boardGate.canAct) {
      notify(boardGate.refusal)
      return
    }
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
    // The verdict and the PAINTED fields are one computation: whatever is drawn
    // as a destination is accepted, a drawn PREVIEW is refused with a reason,
    // and a plain hex is still the deselect gesture.
    const verdict = boardClickVerdict(state, boardGate, label)
    switch (verdict.kind) {
      case 'move':
        apply({
          type: 'move',
          legionId: verdict.legionId,
          toHex: verdict.toHex,
          teleport: verdict.teleport,
        })
        break
      case 'deselect':
        apply({ type: 'deselectLegion' })
        break
      case 'refuse':
        notify(verdict.message)
        break
      case 'ignore':
        break
    }
  }

  const onLegionClick = (legionId: string) => {
    if (!state) return
    // Selecting is itself acting: a spectator or the other seat is told why,
    // rather than the click vanishing.
    if (!boardGate.canAct) {
      notify(boardGate.refusal)
      return
    }
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
    if (state.phase === 'Move' && state.selectedLegionId === legionId && !isAiActing(state)) {
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
    if (!state?.battle?.selectedUnitId || !interactive) return
    if (state.battle.phase === 'Move') {
      apply({ type: 'battleMove', unitId: state.battle.selectedUnitId, toHex: hex })
    }
  }

  const onBattleUnit = (unitId: string) => {
    if (!state?.battle || !interactive) return
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
        commitPath.local((prev) =>
          animatingRef.current || prev.pendingDice ? prev : applyEnterKeyPhaseEnd(prev),
        )
        return
      }
      const cmd = phaseEndCommand(state)
      if (!cmd) return
      e.preventDefault()
      apply(cmd)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [interactive, state, apply, pendingStrike, commitPath])

  if (loading) return <div className="boot">Loading Default variant…</div>
  if (error && !state) return <div className="boot error">Error: {error}</div>
  if (!state) {
    return (
      <SetupScreen
        onStart={start}
        onMultiplayerStart={startMultiplayer}
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
  const actorId = actingPlayerId(state)
  const actor = state.players.find((p) => p.id === actorId)
  const engagement = state.activeEngagement && state.phase === 'Fight' ? state.activeEngagement : null
  const engagementLabel =
    engagement === null
      ? null
      : (() => {
          const a = state.legions.find((l) => l.id === engagement.attackerId)
          const d = state.legions.find((l) => l.id === engagement.defenderId)
          return `Engagement ${a?.markerId ?? '?'} vs ${d?.markerId ?? '?'}`
        })()
  const turnLabel = engagementLabel ?? `${actor?.name ?? '?'}'s turn`

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand-inline">Colossus</span>
        <span className="muted">
          {state.variant.data.name} · {multiplayer === null ? 'local' : 'multiplayer'}
        </span>
        {multiplayer !== null && (
          <MultiplayerStatus
            seat={multiplayer.seat}
            seatCount={multiplayer.seatCount}
            turnLabel={turnLabel}
            myTurn={myTurn}
            gameOver={gameOver}
            status={syncStatus}
            failure={syncFailure}
          />
        )}
        {state.winnerId && (
          <span className="winner">
            {state.players.find((p) => p.id === state.winnerId)?.name} wins!
          </span>
        )}
        {state.draw && <span className="winner">Draw!</span>}
        <span className="topbar-spacer" />
        {saveFlash && <span className="save-flash">{saveFlash}</span>}
        <BackgroundAtmosphereSelect className="ai-speed bg-atmosphere-select" />
        {!gameOver && multiplayer === null && (
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
        <button
          type="button"
          className="ghost"
          onClick={() => {
            stopSession()
            forgetActiveGame()
            putState(null)
          }}
        >
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
          <BoardDecisionOverlay
            state={state}
            dispatch={apply}
            interactive={interactive}
            pendingStrike={pendingStrike}
            onCancelPendingStrike={() => setPendingStrike(null)}
            myPlayerId={myPlayerId}
          />
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
        />
      </main>
    </div>
  )
}
