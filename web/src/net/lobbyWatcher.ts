/**
 * The lobby's JOB on the ONE poll loop — the thing the owner's first live test
 * found missing.
 *
 * He created a game in browser A and joined it in browser B, and A never saw B
 * arrive: the lobby refreshed only on mount, on an action and on the Refresh
 * button (`lobby.ts` was a one-shot read and `LobbyPanel` deliberately watched
 * nothing). Start needs two joined players **as the creator's own view sees
 * them**, so A's Start stayed disabled and the second symptom — "no way to
 * start" — was the first symptom's consequence, not a second bug.
 *
 * ## What this module is, and is not
 *
 * It is the lobby's tick: refresh the GAME LIST and, when a game is open,
 * refresh that game's RECORD and PARTICIPANTS. It owns NO timer — the timer, the
 * visibility rule, the backoff and the stop handle are `sync.ts`'s
 * {@link pollLoop}, which registers this job at {@link LOBBY_POLL_INTERVAL_MS}.
 * A second `setTimeout` here would be the defect the old comment feared.
 *
 * The two loops in this app (this one and the game's snapshot sync) are never
 * alive at once: a game REPLACES the setup screen (`App.tsx` renders
 * `SetupScreen` only while no game state exists), and each takes its loop down on
 * unmount. So "one poll loop" holds both structurally and in time.
 *
 * It is also a small store the React panel subscribes to, so the panel is a
 * RENDERER: `refresh()` is reachable from the loop, from a user action and from
 * the Refresh button, and all three land in the same snapshot. That is what makes
 * "my own action refreshes immediately, without waiting for a tick" true.
 *
 * ## The seam question
 *
 * Every read and write still goes through `net/lobby.ts` (`listGames`,
 * `readLobby`, `createGame`, `joinGame`, `leaveGame`, `startGame`); every refusal
 * is still that module's thrown `ServerStoreError`, mapped by the ONE
 * `describeFailure`. This file adds a cadence and a subscription, nothing else.
 */

import { readActiveGame } from './activeGame'
import { createContentCache, type ContentCache } from './contentCache'
import { describeFailure, type FailureDescription } from './failure'
import { gameObjectName } from './gameRecord'
import {
  createGame,
  joinGame,
  leaveGame,
  listGamesFrom,
  readLobby,
  startGame,
  type ActiveLobby,
  type CreateGameRequest,
  type GameListing,
  type LobbyContext,
} from './lobby'
import { pollLoop, type PollHandle, type PollStatus, type VisibilitySource } from './sync'

/**
 * ~5s in the lobby — a judgement call, justified rather than decreed.
 *
 * Nobody in the lobby is blocked on a turn, so the game's ~2s (where latency IS
 * the experience) is not needed: the human-paced event being watched is
 * "somebody else pressed Join", and five seconds is under the threshold where a
 * person concludes a screen is broken. It is also a cheap cadence against an
 * unpaginated list route — every tick is ONE `list` (plus a `get` per game and
 * per joined player), so ~12 list reads a minute, and only while the tab is
 * visible: a hidden tab sends nothing at all.
 */
export const LOBBY_POLL_INTERVAL_MS = 5000

/** Everything the lobby panel draws, as ONE immutable snapshot. */
export interface LobbyData {
  /** The game list, or `null` until the first read lands. */
  readonly listing: GameListing | null
  /** The game this client opened in the lobby (created, joined or resumed). */
  readonly active: ActiveLobby | null
  /**
   * The last refusal — from a POLL or from the caller's own action — or `null`.
   * A successful read clears it, because the store just answered: an old refusal
   * left on screen after a good read would be a lie about the present.
   */
  readonly failure: FailureDescription | null
  /** The loop's own health, for the freshness signal. */
  readonly status: PollStatus | null
}

export interface LobbyWatcherOptions {
  readonly context: LobbyContext
  /** Defaults to {@link LOBBY_POLL_INTERVAL_MS}. */
  readonly intervalMs?: number
  /** Defaults to the browser's `document.visibilityState`. */
  readonly visibility?: VisibilitySource
  /**
   * Where the loop's own health goes. The React panel supplies the setter its
   * `usePolledStatus` handed it, so the status lives in ONE place.
   */
  readonly onStatus?: (status: PollStatus) => void
}

/**
 * The lobby, live: ONE subscription, ONE tick, and one place the panel's actions
 * go through. Plain TypeScript (no React, no `fetch` beyond the transport seam),
 * so every pin below runs without a browser.
 */
export class LobbyWatcher {
  private readonly context: LobbyContext
  private readonly intervalMs: number
  private readonly visibility: VisibilitySource | undefined
  private readonly onStatus: ((status: PollStatus) => void) | undefined
  private readonly listeners = new Set<() => void>()
  /**
   * The bodies this watcher has already read, by content address. Without it a
   * tick would re-read every listed game's body; with it the steady state is one
   * list request and zero body reads (`contentCache.ts`).
   */
  private readonly cache: ContentCache

  private listing: GameListing | null = null
  private active: ActiveLobby | null = null
  private activeGameId: string | null = null
  private failure: FailureDescription | null = null
  private status: PollStatus | null = null
  private closed = false
  private poller: PollHandle | null = null
  private refreshInFlight: Promise<void> | null = null
  private data: LobbyData

  constructor(options: LobbyWatcherOptions) {
    this.context = options.context
    this.intervalMs = options.intervalMs ?? LOBBY_POLL_INTERVAL_MS
    this.visibility = options.visibility
    this.onStatus = options.onStatus
    this.cache = createContentCache({
      transport: options.context.transport,
      store: options.context.store,
    })
    // The resume pointer is read ONCE, here, and never inside `refresh`: the user
    // can press "Back to games" (which closes the game view without leaving the
    // game), and a poll must not undo that by re-reading the pointer. A CORRUPT
    // pointer is a refusal like any other — stored and shown, never thrown from a
    // constructor (which would take the panel down with it).
    try {
      this.activeGameId = readActiveGame()
    } catch (error) {
      this.failure = describeFailure(error)
    }
    this.data = this.snapshotOf()
  }

  // --- the store the panel subscribes to -----------------------------------

  getData = (): LobbyData => this.data

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private snapshotOf(): LobbyData {
    return {
      listing: this.listing,
      active: this.active,
      failure: this.failure,
      status: this.status,
    }
  }

  private publish(): void {
    this.data = this.snapshotOf()
    for (const listener of [...this.listeners]) listener()
  }

  // --- the loop -------------------------------------------------------------

  /**
   * Begin watching, and refresh ONCE at once. Idempotent: calling it on a live
   * watcher does nothing, so it can be called from a React effect that re-runs.
   */
  start(): void {
    if (this.closed || this.poller !== null) return
    this.poller = pollLoop({
      intervalMs: this.intervalMs,
      visibility: this.visibility,
      onTick: () => this.pollOnce(),
      onStatus: (status) => {
        this.status = status
        this.onStatus?.(status)
        this.publish()
      },
      onError: (failure) => {
        // LOUD: a failed tick is shown, never swallowed (AGENTS.md rule 1).
        this.failure = failure
      },
    })
  }

  /** Stop watching for good. Idempotent; a late read's result is discarded. */
  close(): void {
    this.closed = true
    this.poller?.stop()
    this.poller = null
    this.listeners.clear()
  }

  // --- reads ----------------------------------------------------------------

  /**
   * ONE poll tick: read the list, and — when a game is open — that game's record
   * and its joined players. Both reads share this one tick, so a tick is one loop
   * iteration, never two timers racing.
   *
   * A poll NEVER rejects: the loop must keep ticking after a failure (that is
   * what backoff is for), and the refusal is published for the panel either way.
   * `refresh()` is the same read for a caller that wants the refusal to throw.
   */
  /**
   * ONE poll tick. The refusal is PUBLISHED for the panel AND RETHROWN for the
   * loop: the loop's own error path is what counts failures, backs off and
   * reports phase `'error'`, so swallowing here would make a failing lobby read
   * look like a healthy one.
   */
  private async pollOnce(): Promise<void> {
    if (this.closed) return
    if (this.refreshInFlight !== null) return this.refreshInFlight
    const task = this.read()
      .catch((error: unknown) => {
        this.failure = describeFailure(error)
        this.publish()
        throw error
      })
      .finally(() => {
        this.refreshInFlight = null
      })
    this.refreshInFlight = task
    return task
  }

  /** Read now — the Refresh button, on mount, and after an action. May reject. */
  async refresh(): Promise<void> {
    if (this.closed) return
    // Coalesce onto a read already in flight (the loop's own first tick, say),
    // so a mount never fires two list reads.
    if (this.refreshInFlight !== null) return this.refreshInFlight
    const task = this.read().finally(() => {
      this.refreshInFlight = null
    })
    this.refreshInFlight = task
    return task
  }

  private async read(): Promise<void> {
    // ONE list per tick, for BOTH jobs: the games, the active game's record and
    // its players all come from this one listing. Bodies are then read by NAME,
    // and only where the listing's `sha256` says they changed.
    const objects = await this.context.transport.list(this.context.store)
    const listing = await listGamesFrom(this.context, objects, this.cache)
    let active: ActiveLobby | null = null
    const wanted = this.activeGameId
    if (wanted !== null) {
      const name = gameObjectName(wanted)
      if (objects.some((object) => object.name === name)) {
        active = await readLobby(this.context, wanted, { objects, cache: this.cache })
      } else {
        // The game is GONE (deleted, or never there any more). That is not a
        // refusal: the view closes, and the cache drops the name on the next
        // listing. The caller decides whether to forget the resume pointer.
        this.activeGameId = null
        this.cache.forget(name)
      }
    }
    if (this.closed) return
    this.listing = listing
    this.active = active
    // The store just answered: a refusal shown before it is history now.
    this.failure = null
    this.publish()
  }

  // --- the panel's actions --------------------------------------------------

  /**
   * Open the game this client is (or was) in. The panel remembers the resume
   * pointer itself (`rememberActiveGame`), because the pointer belongs to the
   * app; this only decides what is READ.
   */
  async setActiveGame(gameId: string | null): Promise<void> {
    this.activeGameId = gameId
    if (gameId === null) {
      this.active = null
      this.publish()
      return
    }
    await this.refresh()
  }

  create(request: CreateGameRequest): Promise<void> {
    return this.act(async () => {
      const created = await createGame(this.context, request)
      // The creator is a player too: Create wrote the game object, this is the
      // creator's own join — a second object owned by this client.
      await joinGame(this.context, created.gameId)
      this.activeGameId = created.gameId
      await this.refresh()
    })
  }

  join(gameId: string): Promise<void> {
    return this.act(async () => {
      await joinGame(this.context, gameId)
      this.activeGameId = gameId
      await this.refresh()
    })
  }

  leaveGame(): Promise<void> {
    return this.act(async () => {
      if (this.activeGameId === null) return
      await leaveGame(this.context, this.activeGameId)
      this.activeGameId = null
      this.active = null
      await this.refresh()
    })
  }

  startGame(): Promise<void> {
    return this.act(async () => {
      if (this.activeGameId === null) return
      await startGame(this.context, this.activeGameId, this.cache)
      await this.refresh()
    })
  }

  /** Close the game view without touching the store (the panel decides to). */
  back(): void {
    this.activeGameId = null
    this.active = null
    this.publish()
  }

  /**
   * Every action's own refresh is IMMEDIATE — it awaits its read here rather than
   * waiting for the next tick, so an action's result is on screen at once, and
   * the in-flight read also coalesces the tick that would have followed it. A
   * refusal is stored AND rethrown, so the panel can decide what to say about it.
   */
  private async act(run: () => Promise<void>): Promise<void> {
    try {
      await run()
    } catch (error) {
      this.failure = describeFailure(error)
      this.publish()
      throw error
    }
  }
}
