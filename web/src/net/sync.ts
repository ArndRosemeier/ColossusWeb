/**
 * Turn sync — the slice that makes a started game PLAYABLE.
 *
 * The authoritative state is **the latest snapshot object** (`snapshot.ts` owns
 * the name and the body). After a local command the acting client publishes a
 * new snapshot; everyone else polls, notices a greater name and adopts it. There
 * is no server authority anywhere: the store is a shared bucket, so the rules
 * here are the whole mechanism, and the engine's own refusal inside
 * `applyCommand` is the backstop rather than the guard.
 *
 * ## The seams this module owns
 *
 * | Idea | The ONE implementation |
 * | --- | --- |
 * | reading/writing state | `serializeGame` / `deserializeGame` (`persistence/saveGame.ts`) — never a second format |
 * | publishing | {@link publishSnapshot} |
 * | reading the newest state | {@link fetchLatest} (greatest name, fork SURFACED) |
 * | adopting | {@link adopt} (deserialise + preserve local UI fields) |
 * | a local command changing state | {@link createCommitPath} — the only path that publishes |
 * | whose turn a seat may act | {@link actingPlayerIds} / {@link isMyTurn} |
 * | polling | {@link pollLatest} |
 *
 * ## Why `sss` is seeded from the parent
 *
 * `GameState.turnNumber` is the ROUND (`GameEngine.ts`: it increments only when
 * the active seat wraps back to the first). An independent per-writer counter
 * reset each "turn" would therefore let player 0's older `s.0001.002` beat
 * player 1's newer `s.0001.000`, silently losing moves. The publish counter is
 * thus the SUCCESSOR of the counter of the snapshot the state derives from — so
 * the name is monotonic along the parent chain, while two clients deriving from
 * the same parent still collide on `(turn, seq)` and produce a detectable FORK.
 * See `snapshot.ts`'s header for the measurement.
 */

import type { NewGameOptions, GameCommand, GameState, PlayerKind } from '../engine/types'
import { PLAYER_COLORS } from '../engine/types'
import { deserializeGame, serializeGame, type SavedGameBlob } from '../persistence/saveGame'
import type { LoadedVariant } from '../variant/loadVariant'
import { describeFailure, type FailureDescription } from './failure'
import {
  assertGameId,
  playerTagFor,
  seatIndexOf,
  type GameRecord,
  type PlayerRecord,
} from './gameRecord'
import {
  SNAPSHOT_SCHEMA_VERSION,
  chooseSnapshot,
  detectFork,
  newestSnapshotGroup,
  parseSnapshot,
  serializeSnapshot,
  snapshotObjectName,
  snapshotRefsForGame,
  type SnapshotBody,
  type SnapshotFork,
  type SnapshotRef,
} from './snapshot'
import { serverStoreName } from './storeName'
import {
  ServerStoreError,
  assertStoreName,
  type ServerStoreTransport,
  type StoreIdentity,
} from './transport'

/** ~2s: there is no push channel, so the interval is the only throttle we have. */
export const DEFAULT_POLL_INTERVAL_MS = 2000

/**
 * What the lobby hands to the app when a game opens.
 *
 * `mode` decides the FIRST write: the creator (`host`) publishes the opening
 * snapshot; everyone else (`adopt`) reads the newest one. Both build the same
 * local board first ({@link multiplayerSeatOptions} seeds `createGame` from the
 * game id), so no client ever shows a different opening position.
 */
export interface MultiplayerHandoff {
  readonly record: GameRecord
  readonly players: PlayerRecord[]
  readonly identity: StoreIdentity
  readonly mode: 'host' | 'adopt'
}

// ---------------------------------------------------------------------------
// The session: what one client knows about one game while it is open
// ---------------------------------------------------------------------------

/**
 * The client-side publish cursor. `turn`/`seq` are the `(turn, seq)` of the
 * last snapshot this client published OR adopted; `last` is its full name, which
 * becomes the `parent` of the next snapshot and the held name for fork
 * resolution. Mutable by design — it is a cursor, not state.
 */
export interface SnapshotTracker {
  turn: number | null
  seq: number
  last: string | null
}

export function createSnapshotTracker(): SnapshotTracker {
  return { turn: null, seq: -1, last: null }
}

/** Everything one open multiplayer game needs. Plain data plus a transport. */
export interface SyncSession {
  readonly transport: ServerStoreTransport
  readonly identity: StoreIdentity
  readonly record: GameRecord
  readonly store: string
  readonly tracker: SnapshotTracker
}

export function createSyncSession(options: {
  transport: ServerStoreTransport
  identity: StoreIdentity
  record: GameRecord
  store?: string
  tracker?: SnapshotTracker
}): SyncSession {
  const store = options.store ?? serverStoreName()
  assertStoreName(store)
  assertGameId(options.record.gameId)
  return {
    transport: options.transport,
    identity: options.identity,
    record: options.record,
    store,
    tracker: options.tracker ?? createSnapshotTracker(),
  }
}

/**
 * The seed for the local board every client builds from the same game record.
 * `createGame` shuffles starting towers with it (`GameEngine.ts`), so deriving
 * it from the `gameId` makes the pre-adoption state identical on every client —
 * no client can briefly show a different board from the others.
 */
export function gameSeedFor(gameId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < gameId.length; i++) {
    hash ^= gameId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * The engine options for a multiplayer game: seats in the record's explicit
 * `seatOrder`, every one of them a HUMAN (a multiplayer seat is a person holding
 * a key), the same seed on every client, and physical dice.
 *
 * A seat with no player record is a LOUD `missing_seat`: guessing a name would
 * hide a broken game, and an AI seat is a LOUD `ai_seat_unsupported` — the app
 * never drives an AI in a multiplayer game, because two clients doing so would
 * diverge.
 */
export function multiplayerSeatOptions(
  record: GameRecord,
  players: readonly PlayerRecord[],
): NewGameOptions {
  if (record.seatOrder.length < 2) {
    throw new ServerStoreError(
      'not_enough_seats',
      `"${record.displayName}" has ${record.seatOrder.length} seat(s); a game needs at least 2`,
    )
  }
  const byId = new Map(players.map((player) => [player.playerId, player]))
  const seats = record.seatOrder.map((playerId, index) => {
    const player = byId.get(playerId)
    if (!player) {
      throw new ServerStoreError(
        'missing_seat',
        `seat ${index} of "${record.gameId}" has no player record for id ${JSON.stringify(playerId)}`,
      )
    }
    const kind: PlayerKind = 'human'
    return {
      name: player.label,
      kind,
      colorId: PLAYER_COLORS[index % PLAYER_COLORS.length]!.id,
    }
  })
  return {
    variantName: record.variant,
    seed: gameSeedFor(record.gameId),
    diceMode: 'physical',
    players: seats,
  }
}

/**
 * A multiplayer game is humans only. A started game that somehow contains an AI
 * seat is refused LOUDLY rather than played: two clients would each drive the
 * same AI and diverge, which is exactly the failure this slice exists to avoid.
 */
export function assertHumanSeats(state: GameState): void {
  const ai = state.players.filter((player) => player.kind !== 'human')
  if (ai.length > 0) {
    throw new ServerStoreError(
      'ai_seat_unsupported',
      `multiplayer seats are humans who hold keys; this game has ${ai.length} AI seat(s): ${ai.map((p) => p.name).join(', ')}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export interface PublishOptions {
  /** The store to write to; defaults to `serverStoreName()`. */
  store?: string
  /**
   * The publish cursor. Supply the session's so the counter follows the parent
   * chain. Omitted, the snapshot is published at `seq 0` (the first snapshot).
   */
  tracker?: SnapshotTracker
  /** Override the parent; defaults to the tracker's last published/adopted name. */
  parentName?: string | null
}

export interface PublishResult {
  readonly name: string
  readonly body: SnapshotBody
}

/**
 * Publish ONE snapshot of `state` — the acting client's whole write path.
 *
 * The seat comes from the record's `seatOrder`; a caller who is not seated is
 * refused (`not_seated`) rather than publishing as seat 0. The counter advances
 * SYNCHRONOUSLY before the `await`, so two publishes in the same tick reserve
 * different seq values and cannot silently collide with themselves.
 */
export async function publishSnapshot(
  transport: ServerStoreTransport,
  identity: StoreIdentity,
  record: GameRecord,
  state: GameState,
  options: PublishOptions = {},
): Promise<PublishResult> {
  const store = options.store ?? serverStoreName()
  assertStoreName(store)
  const seat = seatIndexOf(record, identity.id)
  if (seat < 0) {
    throw new ServerStoreError(
      'not_seated',
      `${identity.label} is not seated in "${record.displayName}" — only the ${record.seatOrder.length} seated players may publish`,
    )
  }
  assertHumanSeats(state)

  const tracker = options.tracker
  const turn = state.turnNumber
  const seq = tracker !== null && tracker !== undefined && tracker.turn === turn ? tracker.seq + 1 : 0
  if (tracker) {
    tracker.turn = turn
    tracker.seq = seq
  }
  const parent =
    options.parentName !== undefined ? options.parentName : (tracker?.last ?? null)
  const tag = playerTagFor(identity.id)
  const name = snapshotObjectName(record.gameId, turn, seq, tag)
  const body: SnapshotBody = {
    header: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      name,
      gameId: record.gameId,
      turn,
      seq,
      writerTag: tag,
      seat,
      parent,
      createdAt: new Date().toISOString(),
    },
    // The ONE state serialiser, unchanged. It strips the heavy `variant`
    // payload; the game record names the variant every client loads.
    state: serializeGame(state),
  }
  await transport.put(store, name, serializeSnapshot(body))
  if (tracker) tracker.last = name
  return { name, body }
}

// ---------------------------------------------------------------------------
// Fetch + adopt
// ---------------------------------------------------------------------------

export interface LatestSnapshot {
  readonly body: SnapshotBody
  readonly ref: SnapshotRef
  /** Non-null when two writers published at the newest `(turn, seq)`. */
  readonly fork: SnapshotFork | null
  /** How many snapshots exist at the newest `(turn, seq)`. */
  readonly groupSize: number
}

export interface FetchOptions {
  store?: string
  /** The snapshot this client currently holds — used to break a fork deterministically. */
  heldName?: string | null
}

/**
 * Read the newest snapshot of a game: list, filter to the game's snapshots, take
 * the GREATEST name, then read every body at that `(turn, seq)`.
 *
 * A fork — more than one writer at the newest position — is returned so the
 * caller can SURFACE it; the choice among the fork's members is deterministic
 * ({@link chooseSnapshot}: the parent we hold, else the lowest tag). A body that
 * does not parse, or that disagrees with its own object name, is a LOUD
 * `bad_snapshot`; it is never skipped as if the game had no such move.
 */
export async function fetchLatest(
  transport: ServerStoreTransport,
  gameId: string,
  options: FetchOptions = {},
): Promise<LatestSnapshot | null> {
  const store = options.store ?? serverStoreName()
  assertStoreName(store)
  assertGameId(gameId)

  const refs = snapshotRefsForGame(await transport.list(store), gameId)
  if (refs.length === 0) return null

  const group = newestSnapshotGroup(refs)
  const candidates: Array<{ ref: SnapshotRef; parent: string | null; body: SnapshotBody }> = []
  for (const ref of group) {
    const value = (await transport.get(store, ref.name)).value
    const body = parseSnapshot(value)
    if (body.header.name !== ref.name) {
      throw new ServerStoreError(
        'bad_snapshot',
        `${ref.name}: the body names ${JSON.stringify(body.header.name)}`,
      )
    }
    if (body.header.gameId !== gameId) {
      throw new ServerStoreError(
        'bad_snapshot',
        `${ref.name}: the body's gameId is ${JSON.stringify(body.header.gameId)}`,
      )
    }
    candidates.push({ ref, parent: body.header.parent, body })
  }

  const chosen = chooseSnapshot(
    candidates.map(({ ref, parent }) => ({ ref, parent })),
    options.heldName ?? null,
  )
  const winner = candidates.find((candidate) => candidate.ref.name === chosen.ref.name)!
  return {
    body: winner.body,
    ref: chosen.ref,
    fork: detectFork(group),
    groupSize: group.length,
  }
}

/**
 * The local-only fields of `GameState` — the ones that describe what THIS client
 * is looking at rather than what the game is. Adoption keeps them: a remote move
 * must not deselect the legion I was inspecting. Everything else (including
 * `diceRoll` and `pendingDice`, which are engine flow, and `message`, which is
 * how the actor's move is announced) comes from the adopted state.
 */
export const LOCAL_UI_FIELDS = ['selectedLegionId', 'legalHexes'] as const

function preserveLocalUi(next: GameState, local: GameState): void {
  const selected =
    local.selectedLegionId !== null && next.legions.some((legion) => legion.id === local.selectedLegionId)
      ? local.selectedLegionId
      : null
  next.selectedLegionId = selected
  next.legalHexes = selected === null ? [] : [...local.legalHexes]
}

/**
 * Adopt a remote snapshot: `deserializeGame` (the ONE deserialiser, which
 * validates the save version, the variant name and the whole state shape) plus
 * the local UI fields. `local` may be null (the first adoption of a resumed
 * game), in which case the adopted state is used as-is.
 */
export function adopt(
  remote: SnapshotBody,
  local: GameState | null,
  variant: LoadedVariant,
): GameState {
  const next = deserializeGame(remote.state as SavedGameBlob, variant)
  if (local !== null) preserveLocalUi(next, local)
  return next
}

// ---------------------------------------------------------------------------
// Turn authority
// ---------------------------------------------------------------------------

/**
 * The seats that may act RIGHT NOW. Titan's rule gives one seat the turn, but
 * the engine has two places where a second seat legitimately acts:
 *
 *  - a **pre-battle engagement** — the defender chooses flee/fight and answers
 *    an agreement, while the active (attacking) seat may propose; and
 *  - a pending physical **throw**, which only its thrower may commit (committing
 *    someone else's throw would fall back to the RNG and diverge).
 *
 * A battle step belongs to `battle.activePlayerId`, which alternates; the
 * post-battle reinforcement belongs to the defender. Everything else is the
 * active seat. The engine still refuses an illegal command per seat, so this is
 * a UI rule plus a backstop, exactly as the design says.
 */
export function actingPlayerIds(state: GameState): string[] {
  if (state.pendingDice) return [state.pendingDice.playerId]
  if (state.battle && !state.battle.done) return [state.battle.activePlayerId]
  if (state.pendingPostBattleReinforce) {
    const legion = state.legions.find(
      (l) => l.id === state.pendingPostBattleReinforce!.legionId,
    )
    if (legion) return [legion.playerId]
  }
  if (state.activeEngagement && state.phase === 'Fight') {
    const engagement = state.activeEngagement
    const ids = [engagement.attackerId, engagement.defenderId]
      .map((legionId) => state.legions.find((l) => l.id === legionId)?.playerId)
      .filter((id): id is string => typeof id === 'string')
    return [...new Set(ids)]
  }
  const active = state.players[state.activePlayerIndex]
  return active ? [active.id] : []
}

/** The primary actor — whose turn it is for display. */
export function actingPlayerId(state: GameState): string {
  return actingPlayerIds(state)[0] ?? ''
}

/** May this player act now? The predicate the board's `interactive` flag uses. */
export function isMyTurn(state: GameState, playerId: string): boolean {
  return actingPlayerIds(state).includes(playerId)
}

/**
 * Commands that only touch the local UI. They still go through the ONE commit
 * path (state is state), but they do NOT publish a snapshot: selection is
 * preserved on adoption (`LOCAL_UI_FIELDS`) and publishing it would churn the
 * seq for something no other client may observe.
 */
const LOCAL_ONLY_COMMANDS: ReadonlySet<GameCommand['type']> = new Set([
  'selectLegion',
  'deselectLegion',
])

export function isSharedCommand(command: GameCommand): boolean {
  return !LOCAL_ONLY_COMMANDS.has(command.type)
}

// ---------------------------------------------------------------------------
// The ONE commit path
// ---------------------------------------------------------------------------

export interface CommitPathOptions {
  getState: () => GameState | null
  /** The single setter; the ONLY thing that writes the app's game state. */
  setState: (next: GameState) => void
  /** The open multiplayer session, or a function returning null for hotseat/AI. */
  getSession: () => SyncSession | null
  onPublished?: (result: PublishResult) => void
  onFailure?: (failure: FailureDescription) => void
}

export interface CommitPath {
  /**
   * Run a LOCAL reducer (one command) through the one path: state changes AND,
   * for a shared command in a multiplayer game with no pending throw, exactly
   * one snapshot is published. Returns the new state, or null when nothing
   * changed.
   */
  local(mutator: (prev: GameState) => GameState, command?: GameCommand): GameState | null
  /** Adopt a remote snapshot through the SAME path. NEVER publishes. */
  remote(body: SnapshotBody, variant: LoadedVariant): GameState | null
  /** Publish the current state without a command (the Start hand-off). */
  publishCurrent(): void
  /** Resolves when every publish started so far has settled (used by tests). */
  settled(): Promise<void>
}

/**
 * The app's ONE state-changing seam. Every local command and every remote
 * adoption goes through this object, so no path can change the game state
 * without the publish question being asked — and adoption can never publish.
 */
export function createCommitPath(options: CommitPathOptions): CommitPath {
  const pending = new Set<Promise<void>>()

  function publish(session: SyncSession, state: GameState): void {
    const task: Promise<void> = publishSnapshot(
      session.transport,
      session.identity,
      session.record,
      state,
      { store: session.store, tracker: session.tracker },
    )
      .then((result) => {
        options.onPublished?.(result)
      })
      .catch((error: unknown) => {
        options.onFailure?.(describeFailure(error))
      })
    pending.add(task)
    void task.finally(() => pending.delete(task))
  }

  return {
    local(mutator, command) {
      const prev = options.getState()
      if (prev === null) return null
      const next = mutator(prev)
      if (next === prev) return null
      options.setState(next)
      const session = options.getSession()
      if (session && (command === undefined || isSharedCommand(command)) && !next.pendingDice) {
        publish(session, next)
      }
      return next
    },
    remote(body, variant) {
      const session = options.getSession()
      if (session && session.tracker.last !== null && body.header.name <= session.tracker.last) {
        // Older than (or the same as) what we already hold — including our own
        // snapshot coming back to us. Nothing to adopt.
        return null
      }
      const next = adopt(body, options.getState(), variant)
      options.setState(next)
      if (session) {
        session.tracker.last = body.header.name
        session.tracker.turn = body.header.turn
        session.tracker.seq = body.header.seq
      }
      return next
    },
    publishCurrent() {
      const session = options.getSession()
      const state = options.getState()
      if (!session || !state || state.pendingDice) return
      publish(session, state)
    },
    async settled() {
      while (pending.size > 0) {
        await Promise.all([...pending])
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

/** Where "is the tab visible?" comes from — injectable, so the pin needs no DOM. */
export interface VisibilitySource {
  visible(): boolean
  subscribe(listener: () => void): () => void
}

export function browserVisibility(): VisibilitySource {
  if (typeof document === 'undefined') {
    return { visible: () => true, subscribe: () => () => {} }
  }
  return {
    visible: () => document.visibilityState === 'visible',
    subscribe: (listener) => {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
  }
}

export interface SyncStatus {
  readonly phase: 'idle' | 'polling' | 'error' | 'stopped'
  readonly polls: number
  readonly failures: number
  readonly lastError: FailureDescription | null
  readonly fork: SnapshotFork | null
  readonly lastPolledAt: string | null
}

export interface PollOptions {
  /** Defaults to {@link DEFAULT_POLL_INTERVAL_MS}. */
  intervalMs?: number
  onAdopt: (body: SnapshotBody, fork: SnapshotFork | null) => void
  onStatus?: (status: SyncStatus) => void
  /** Defaults to the browser's `document.visibilityState`. */
  visibility?: VisibilitySource
  /** Stops the loop when aborted, in addition to the returned handle. */
  signal?: AbortSignal
}

export interface PollHandle {
  stop(): void
}

/**
 * Poll for the newest snapshot. Only ONE request is in flight at a time; the
 * next is scheduled when the previous settles, so a slow store can never build a
 * backlog. `setTimeout` recursion, not `setInterval`, so backoff is possible.
 *
 * - **Hidden tab → no request at all.** The timer still fires, sees the tab is
 *   hidden and reschedules; becoming visible again polls immediately.
 * - **Error → backoff.** The interval doubles per consecutive failure up to 8×,
 *   and resets to the base interval on the first success.
 * - **Torn down → silent.** `stop()` (or the `AbortSignal`) clears the timer,
 *   unsubscribes and stops the loop for good.
 */
export function pollLatest(session: SyncSession, options: PollOptions): PollHandle {
  const interval = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const maxInterval = interval * 8
  const visibility = options.visibility ?? browserVisibility()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let failures = 0
  let polls = 0
  let lastError: FailureDescription | null = null
  let fork: SnapshotFork | null = null
  let lastPolledAt: string | null = null

  const report = (phase: SyncStatus['phase']): void => {
    options.onStatus?.({ phase, polls, failures, lastError, fork, lastPolledAt })
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    clearTimer()
    unsubscribe()
    options.signal?.removeEventListener('abort', stop)
    report('stopped')
  }

  function schedule(ms: number): void {
    clearTimer()
    if (stopped) return
    timer = setTimeout(() => {
      timer = null
      void tick()
    }, ms)
  }

  async function tick(): Promise<void> {
    if (stopped) return
    if (options.signal?.aborted) {
      stop()
      return
    }
    if (!visibility.visible()) {
      // The tab is hidden: not a single request is made while it stays hidden.
      report('idle')
      schedule(interval)
      return
    }
    try {
      const latest = await fetchLatest(session.transport, session.record.gameId, {
        store: session.store,
        heldName: session.tracker.last,
      })
      failures = 0
      polls += 1
      lastError = null
      lastPolledAt = new Date().toISOString()
      fork = latest?.fork ?? null
      report('polling')
      if (latest !== null) options.onAdopt(latest.body, latest.fork)
      schedule(interval)
    } catch (error) {
      failures += 1
      lastError = describeFailure(error)
      report('error')
      schedule(Math.min(interval * 2 ** failures, maxInterval))
    }
  }

  const unsubscribe = visibility.subscribe(() => {
    if (!stopped && visibility.visible()) {
      // Became visible: poll now rather than waiting out the current interval.
      clearTimer()
      void tick()
    }
  })
  options.signal?.addEventListener('abort', stop)
  report('idle')
  void tick()

  return { stop }
}
