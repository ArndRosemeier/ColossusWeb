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
 * | watching the store (the timer, visibility, backoff, stop) | {@link pollLoop} |
 * | the GAME's poll job | {@link pollLatest} |
 *
 * ## One loop, two jobs
 *
 * `pollLoop` IS the loop: one timer, one visibility rule, one backoff, one stop
 * handle. The game's snapshot fetch ({@link pollLatest}) and the lobby's list
 * refresh (`net/lobbyWatcher.ts`) are JOBS registered on it, at their own
 * cadences — so "the lobby polls" never means "a second timer exists". Before
 * this, the loop had the game's job welded into it and the lobby deliberately
 * had none; the owner found that the hard way (ledger row 10).
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

import { useEffect, useState } from 'react'
import { getMovesForSelected } from '../engine/GameEngine'
import type { NewGameOptions, GameCommand, GameState, PlayerKind } from '../engine/types'
import { PLAYER_COLORS } from '../engine/types'
import { deserializeGame, serializeGame, type SavedGameBlob } from '../persistence/saveGame'
import type { LoadedVariant } from '../variant/loadVariant'
import { createContentCache, type ContentCache } from './contentCache'
import { describeFailure, formatFailureStatus, type FailureDescription } from './failure'
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
  snapshotObjectPrefixFor,
  snapshotRefsForGame,
  type SnapshotBody,
  type SnapshotFork,
  type SnapshotRef,
} from './snapshot'
import { serverStoreName } from './storeName'
import {
  RATE_LIMITED_CODE,
  ServerStoreError,
  assertStoreName,
  type ServerStoreTransport,
  type StoreIdentity,
} from './transport'

/**
 * The GAME's poll interval — ~2s, because turn latency is what a player feels:
 * a move made by someone else should appear on my board as close to instantly as
 * polling allows. There is no push channel, so the interval is the only throttle
 * there is. The LOBBY polls a different job at a different cadence
 * (`lobbyWatcher.ts`: ~5s — nobody is waiting on a turn there, and a slower list
 * keeps the request rate down), which is why this is named for the GAME rather
 * than being a global "default".
 */
export const GAME_POLL_INTERVAL_MS = 2000

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
  /**
   * The bodies this session has already read, keyed by content address: the ONE
   * reason a tick that changed nothing reads no body at all
   * (`contentCache.ts`). It is per SESSION, not per call, because a per-call
   * cache would never hit.
   */
  readonly cache: ContentCache
}

export function createSyncSession(options: {
  transport: ServerStoreTransport
  identity: StoreIdentity
  record: GameRecord
  store?: string
  tracker?: SnapshotTracker
  cache?: ContentCache
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
    cache: options.cache ?? createContentCache({ transport: options.transport, store }),
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
  /**
   * The bodies this client already holds, by content address. With it, a tick
   * whose newest snapshot is unchanged reads NO body at all; the newest group's
   * members whose `sha256` changed are still read, so fork detection is exactly
   * as it was.
   */
  cache?: ContentCache
}

/**
 * Read the newest snapshot of a game: list THIS GAME's snapshots
 * (`prefix=snap.<gameid>.` — one narrow request, never the whole store), take
 * the GREATEST name, then read every body at that `(turn, seq)`.
 *
 * **The list is for LEARNING NAMES and HASHES, never for content.** `sha256` from
 * the listing is a content address, so a body is point-read by NAME only when it
 * is new or its hash changed ({@link ContentCache}) — the steady state of a tick
 * is one list request and zero body reads. A name the newest group needs but the
 * caller has never read is fetched; one it holds is reused. This changes only the
 * REQUEST COUNT: the ordering (greatest name), the fork detection and the choice
 * among the group are untouched, and a cache entry can never resurrect content
 * whose hash moved (the key IS the hash) or that disappeared (the listing is the
 * only source of names).
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

  const objects = await transport.list(store, snapshotObjectPrefixFor(gameId))
  const byName = new Map(objects.map((object) => [object.name, object] as const))
  const refs = snapshotRefsForGame(objects, gameId)
  if (refs.length === 0) return null

  const group = newestSnapshotGroup(refs)
  const candidates: Array<{ ref: SnapshotRef; parent: string | null; body: SnapshotBody }> = []
  for (const ref of group) {
    const object = byName.get(ref.name)
    if (object === undefined) {
      // Cannot happen: `refs` was filtered from the same listing.
      throw new ServerStoreError(
        'bad_snapshot',
        `${ref.name}: the listing that produced this ref no longer names it`,
      )
    }
    const value = options.cache
      ? await options.cache.adopt(ref.name, object.sha256)
      : (await transport.get(store, ref.name)).value
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
 *
 * **`legalHexes` deliberately is NOT on this list.** It is DERIVED — the answer
 * to "where may the selected legion go, with the current roll, from here" — and
 * preserving it across an adoption keeps a set computed for the PREVIOUS roll
 * and the PREVIOUS board (the S6 regression: the board highlighted the old
 * roll's destinations and the real ones were absent, so no move was accepted).
 * It is recomputed below from the ADOPTED state through the engine's ONE rule.
 */
export const LOCAL_UI_FIELDS = ['selectedLegionId'] as const

function preserveLocalUi(next: GameState, local: GameState): void {
  next.selectedLegionId =
    local.selectedLegionId !== null &&
    next.legions.some((legion) => legion.id === local.selectedLegionId)
      ? local.selectedLegionId
      : null
  // The selection is a preference; its reachable set is DERIVED from the adopted
  // state, never carried over. `getMovesForSelected` is the engine's own rule
  // for it, so there is no second implementation of "where may this legion go".
  next.legalHexes = [...getMovesForSelected(next).keys()]
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
  // A refusal message is this client's OWN surface (ledger row 13): it changes
  // no game data, so it must never churn the shared seq.
  'notice',
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

/**
 * The bounds on a `Retry-After` the loop will honour, in MILLISECONDS. The
 * service's window is 60s, so both are far away from a real value; they exist so
 * a malformed or hostile header cannot park the loop for ever (a stall no user
 * could distinguish from a hang) or spin it inside the window it was told to
 * leave. `FLOOR` is the poll's own base interval: obeying a *smaller* wait than
 * we would have used anyway is not obeying anything.
 */
export const RATE_LIMIT_DELAY_FLOOR_MS = 1000
export const RATE_LIMIT_DELAY_CEILING_MS = 15 * 60 * 1000

/** A `Retry-After` in whole seconds, as a bounded delay in milliseconds. */
function retryDelayMs(seconds: number): number {
  return Math.min(Math.max(seconds * 1000, RATE_LIMIT_DELAY_FLOOR_MS), RATE_LIMIT_DELAY_CEILING_MS)
}

/**
 * When the next tick runs after a FAILED one — the ONE rule about retry timing,
 * exported so its arithmetic can be pinned directly (the loop that USES it is
 * pinned separately; a test that had to infer the delay from tick counts would
 * be testing the fake clock instead).
 *
 *  - **A rate limit OBEYS `Retry-After`.** The service told us how long to leave
 *    it alone, so the delay is that (bounded), NOT the doubling backoff — whose
 *    cap is `interval × 8` (16s in a game, 40s in the lobby) and would therefore
 *    retry INSIDE the 60-second window it was told to wait out, making the
 *    refusal worse. A `429` with no readable header falls back to the backoff,
 *    which is the old behaviour rather than an invented wait.
 *  - **Anything else keeps the existing doubling backoff**, unchanged.
 */
export function nextPollDelayMs(error: unknown, intervalMs: number, failures: number): number {
  if (
    error instanceof ServerStoreError &&
    error.code === RATE_LIMITED_CODE &&
    error.retryAfterSeconds !== undefined
  ) {
    return retryDelayMs(error.retryAfterSeconds)
  }
  return Math.min(intervalMs * 2 ** failures, intervalMs * 8)
}

/**
 * What the ONE poll loop reports about itself, in terms BOTH of its jobs can
 * state — the game's snapshot fetch and the lobby's list refresh. `detail` is
 * the job's own warning, already worded where the job words it: a fork arrives
 * as {@link formatFork}'s sentence, and a failure as
 * `formatFailureStatus`'s (so a rate limit reads as "the store is
 * busy — slowing down", not as an unexplained error). `null` means "nothing to
 * add".
 */
export interface PollStatus {
  readonly phase: 'idle' | 'polling' | 'error' | 'stopped'
  /** Completed ticks. Counted for BOTH jobs, including a tick that found nothing. */
  readonly polls: number
  /** Consecutive failed ticks; `0` while healthy. */
  readonly failures: number
  readonly lastError: FailureDescription | null
  readonly lastPolledAt: string | null
  /**
   * What the job's LAST tick has to say beyond "healthy" — a fork, or the
   * failure that just happened. `null` means "nothing to add".
   */
  readonly detail: string | null
}

/**
 * The ONE poll loop in this app — every "watch the store" job is a TICK of this,
 * never a second timer. `net/lobbyWatcher.ts` registers the lobby job at its own
 * cadence; {@link pollLatest} below registers the game's snapshot fetch. S3's
 * original loop was this loop with the game's job hard-wired in; the behaviour
 * (one request in flight, visibility, backoff, stop handle) is unchanged, it is
 * just no longer welded to one job.
 *
 * - **Only ONE request in flight.** The next tick is scheduled when the previous
 *   one settles, so a slow store can never build a backlog.
 * - **`setTimeout` recursion, not `setInterval`**, so backoff is possible.
 * - **Hidden tab → no request at all.** The timer still fires, sees the tab is
 *   hidden and reschedules; becoming visible again polls immediately.
 * - **Error → backoff.** The interval doubles per consecutive failure up to 8×,
 *   and resets to the base interval on the first success. A RATE LIMIT is the one
 *   exception: a `429` carrying `Retry-After` schedules the next tick no sooner
 *   than that instead ({@link nextPollDelayMs}), because the service's own
 *   instruction beats a backoff that would retry inside the window. The error is
 *   reported (`onStatus` + `onError`) and never swallowed.
 * - **Torn down → silent.** `stop()` (or the `AbortSignal`) clears the timer,
 *   unsubscribes and stops the loop for good.
 *
 * `onTick` may return a promise; a rejection is the error path, exactly as a
 * synchronous throw is. A job that must report "nothing happened differently"
 * simply resolves.
 */
export interface PollLoopOptions {
  /** The job ONE tick performs. A throw (or rejection) is a failed tick. */
  onTick: () => void | Promise<void>
  intervalMs: number
  /** Called on every tick attempt, and once at start with phase `'idle'`. */
  onStatus: (status: PollStatus) => void
  /**
   * What the job's last successful tick wants said out loud (a fork, say). Read
   * when the tick succeeds, and carried on the status from then on.
   */
  onDetail?: () => string | null
  /** Called with the failure of a failed tick, before the backoff is scheduled. */
  onError?: (failure: FailureDescription) => void
  /** Defaults to the browser's `document.visibilityState`. */
  visibility?: VisibilitySource
  /** Stops the loop when aborted, in addition to the returned handle. */
  signal?: AbortSignal
}

export interface PollHandle {
  stop(): void
}

export function pollLoop(options: PollLoopOptions): PollHandle {
  const interval = options.intervalMs
  const visibility = options.visibility ?? browserVisibility()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let failures = 0
  let polls = 0
  let lastError: FailureDescription | null = null
  let lastPolledAt: string | null = null
  let detail: string | null = null

  const report = (phase: PollStatus['phase']): void => {
    options.onStatus({ phase, polls, failures, lastError, lastPolledAt, detail })
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
      await options.onTick()
      failures = 0
      polls += 1
      lastError = null
      lastPolledAt = new Date().toISOString()
      detail = options.onDetail?.() ?? null
      report('polling')
      schedule(interval)
    } catch (error) {
      failures += 1
      lastError = describeFailure(error)
      detail = formatFailureStatus(lastError)
      report('error')
      options.onError?.(lastError)
      // A `429` waits out the `Retry-After` it carried; anything else keeps the
      // doubling backoff (see `nextPollDelayMs`).
      schedule(nextPollDelayMs(error, interval, failures))
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

/**
 * The status of the loop driving the CURRENT screen, plus the failure that
 * starting it hit (a corrupt local pointer, say) — both `null` before a loop runs.
 *
 * This is the hook half of the one loop: it hands the component's `setStatus`
 * into `start` (the starter passes it to its loop's `onStatus`), and stops the
 * loop it started on unmount. `App` and `LobbyPanel` both use it — but they are
 * never mounted together (a game replaces the setup screen), so there is exactly
 * ONE loop alive at a time and never a second timer.
 *
 * `start` is read through a ref, so a caller does not have to memoise it and a
 * changed identity can never silently restart a loop under a live one. A `start`
 * that THROWS is reported as `failure`, not propagated: a watcher that cannot
 * read its own local state must not take the screen down with it.
 */
export interface PolledStatus {
  readonly status: PollStatus | null
  readonly failure: FailureDescription | null
}

export function usePolledStatus(
  start: (report: (status: PollStatus) => void) => PollHandle | null | void,
): PolledStatus {
  const [status, setStatus] = useState<PollStatus | null>(null)
  const [failure, setFailure] = useState<FailureDescription | null>(null)

  useEffect(() => {
    let handle: PollHandle | null | void = null
    try {
      handle = start(setStatus)
    } catch (error) {
      setFailure(describeFailure(error))
      return
    }
    // ONE loop per call site, always: a re-run (a new identity, say) stops the
    // previous session BEFORE the next starts, so two loops can never overlap.
    // `start` IS the dependency — a caller must memoise it (both callers memoise
    // one arrow over values that only change when the session does).
    return () => handle?.stop()
  }, [start])

  return { status, failure }
}

/**
 * The game's fork warning, worded ONCE. `MultiplayerStatus` renders this string
 * and {@link pollLatest} puts it on the status, so the sentence cannot drift from
 * the status the line shows it from.
 */
export function formatFork(fork: SnapshotFork | null): string | null {
  if (fork === null) return null
  const tags = fork.names.map((name) => name.split('.').pop() ?? name).join(', ')
  return `FORK at turn ${fork.turn} seq ${fork.seq} — writers ${tags}; both snapshots kept`
}

export interface PollOptions {
  /** Defaults to {@link GAME_POLL_INTERVAL_MS}. */
  intervalMs?: number
  onAdopt: (body: SnapshotBody, fork: SnapshotFork | null) => void
  onStatus?: (status: PollStatus) => void
  /** Defaults to the browser's `document.visibilityState`. */
  visibility?: VisibilitySource
  /** Stops the loop when aborted, in addition to the returned handle. */
  signal?: AbortSignal
}

/**
 * The GAME's job on the ONE loop: poll for the newest snapshot and adopt it.
 * A thin wrapper — the timer, the visibility rule, the backoff and the stop
 * handle are all {@link pollLoop}'s, so the lobby cannot drift from the game.
 */
export function pollLatest(session: SyncSession, options: PollOptions): PollHandle {
  let fork: SnapshotFork | null = null
  return pollLoop({
    intervalMs: options.intervalMs ?? GAME_POLL_INTERVAL_MS,
    visibility: options.visibility,
    signal: options.signal,
    onStatus: (status) => options.onStatus?.(status),
    // The job's detail is the fork sentence, remembered from the tick so the
    // status carries exactly the fork the adoption did.
    onDetail: () => formatFork(fork),
    onTick: async () => {
      const latest = await fetchLatest(session.transport, session.record.gameId, {
        store: session.store,
        heldName: session.tracker.last,
        cache: session.cache,
      })
      fork = latest?.fork ?? null
      if (latest !== null) options.onAdopt(latest.body, latest.fork)
    },
  })
}
