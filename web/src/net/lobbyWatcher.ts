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
 * Every request it makes is NARROW (S5): `prefix=game.` for the list,
 * `prefix=player.` for the counts, and `prefix=player.<gameid>.` for the game
 * this client is inside. It never lists the whole store.
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
import {
  PLAYER_OBJECT_PREFIX,
  gameObjectName,
  gameObjectsPrefix,
  playerObjectsPrefixFor,
} from './gameRecord'
import {
  GameDeletionError,
  createGame,
  deleteGames,
  deletionPlanFor,
  deleteRefusalAdvice,
  joinGame,
  leaveGame,
  listGamesFrom,
  lobbyContext,
  readLobby,
  retryingContext,
  startGame,
  type ActiveLobby,
  type CreateGameRequest,
  type GameDeletionPlan,
  type GameListing,
  type LobbyContext,
} from './lobby'
import { createRequestRetrier } from './requestRetry'
import { pollLoop, type PollHandle, type PollStatus, type VisibilitySource } from './sync'
import type { ServerStoreTransport, StoreIdentity } from './transport'

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
  /** Where a DELETE of one game has got to, or `null` when none is running. */
  readonly deletion: DeletionUiState | null
}

/**
 * What the panel needs to draw a delete: the plan it is CONFIRMING, and what a
 * running delete has done so far.
 *
 * `plan` is a promise the panel asked for (`planDeletion`), so the confirmation
 * can name the game, its object count and the kinds — never a bare "are you
 * sure?". `deleted`/`total` are the progress of the run; `absent` counts objects
 * that were already gone (another client's delete, say), which are NOT ours to
 * claim. A failure leaves `failure` set AND keeps `deleted`/`total`, so the panel
 * can say exactly what was and was not removed.
 */
export interface DeletionUiState {
  readonly gameId: string
  readonly plan: GameDeletionPlan
  readonly deleted: number
  readonly total: number
  readonly absent: number
  /** True while the DELETEs are in flight. */
  readonly running: boolean
  /** The store's own refusal, when one stopped the run. */
  readonly failure: FailureDescription | null
  /** The ONE actionable sentence for that refusal (`lobby.deleteRefusalAdvice`). */
  readonly advice: string | null
}

export interface LobbyWatcherOptions {
  /** The store client, the caller's identity and the store name — the watcher
   * builds its OWN `LobbyContext` from these, so no caller can hand it a stale or
   * half-built one (see the constructor's note). */
  readonly transport: ServerStoreTransport
  readonly identity: StoreIdentity
  readonly store: string
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
 * A holder the React panel reads through, so `subscribe` and `getSnapshot` can
 * be STABLE before any watcher exists.
 *
 * This is not tidiness — it is the difference between a live lobby and a dead
 * one, measured in a real browser. The panel's first render happens before the
 * effect that builds the watcher, so `useSyncExternalStore` subscribes while the
 * holder is still empty. Returning a no-op subscription there (the obvious
 * implementation) means React NEVER learns about a later change and every tick's
 * data is dropped on the floor: the list stays empty and the creator never sees
 * the joiner — the exact defect this slice exists to remove. So the holder
 * collects listeners until a watcher arrives, hands them over the moment it
 * does, and dispatches every later change itself.
 *
 * The same shape makes a StrictMode mount → unmount → remount safe: each effect
 * pass sets one watcher and detaches it on cleanup, and the rendered value is
 * always the store's, never a reference a render could lose.
 */
export class LobbyStore {
  private watcher: LobbyWatcher | null = null
  private detach: (() => void) | null = null
  private readonly listeners = new Set<() => void>()
  private data: LobbyData = {
    listing: null,
    active: null,
    failure: null,
    status: null,
    deletion: null,
  }

  /** The watcher this store speaks for, for the panel's actions. */
  current(): LobbyWatcher | null {
    return this.watcher
  }

  /** The ONE `useSyncExternalStore` subscribe — stable for the component's life. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** The ONE `useSyncExternalStore` snapshot. Stable until `set` or a tick. */
  getSnapshot = (): LobbyData => this.data

  /**
   * Attach a freshly built watcher (the effect's start), taking over any
   * listeners that subscribed before it existed. Idempotent per watcher: a
   * StrictMode remount may call `set` again with the same instance.
   */
  set(watcher: LobbyWatcher): void {
    if (this.watcher === watcher) return
    // Replace, never abandon: the previous watcher's loop is CLOSED here, so a
    // re-created instance cannot leave a live poll nobody renders (the defect a
    // real browser caught in this slice).
    this.clear()
    this.watcher = watcher
    this.detach = watcher.subscribe(() => this.refresh())
    this.refresh()
  }

  /**
   * Detach the watcher this store holds, if it is still the current one, CLOSING
   * its loop. Omitted, it drops whatever it holds — which is what a replace does.
   */
  clear(watcher?: LobbyWatcher): void {
    if (watcher !== undefined && this.watcher !== watcher) return
    this.detach?.()
    this.detach = null
    this.watcher?.close()
    this.watcher = null
  }

  /** Re-read the watcher and tell every listener — the ONE dispatch. */
  refresh(): void {
    const watcher = this.watcher
    this.data = watcher === null ? this.data : watcher.getData()
    for (const listener of [...this.listeners]) listener()
  }
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
  /**
   * The delete the panel is confirming or running, or `null`. Deliberately NOT
   * cleared by a poll tick: a delete in flight is the user's own action and a
   * background read must not wipe its confirmation or its progress.
   */
  private deletion: DeletionUiState | null = null
  private closed = false
  private poller: PollHandle | null = null
  private refreshInFlight: Promise<void> | null = null
  private data: LobbyData

  constructor(options: LobbyWatcherOptions) {
    // Built HERE, from the three values, never handed in: `lobbyContext` VALIDATES
    // (a null identity would throw), and a caller that passed a memoised context
    // could pass one whose identity had since become null — measured in a real
    // browser as a loop that ticked while every read threw, so the list never
    // refreshed. Rebuilding makes a stale caller unable to break the reader.
    this.context = lobbyContext({
      transport: options.transport,
      identity: options.identity,
      store: options.store,
    })
    this.intervalMs = options.intervalMs ?? LOBBY_POLL_INTERVAL_MS
    this.visibility = options.visibility
    this.onStatus = options.onStatus
    this.cache = createContentCache({ transport: options.transport, store: options.store })
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
      deletion: this.deletion,
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
    // TWO narrow listings per tick when a game is open, ONE when none is: the
    // games (`prefix=game.`, which is EXACTLY the lobby list — the whole point
    // of the S5 rename) and, only for the game this client is inside,
    // `prefix=player.<gameid>.` — exactly its participants. Each body is then
    // read by NAME through the cache, and only where the listing's `sha256` says
    // it changed, so the steady state is these lists and no body reads.
    const objects = await this.context.transport.list(this.context.store, gameObjectsPrefix())
    // The participants of the LISTED games, so each row can show a player count:
    // ONE further narrow request (`prefix=player.`), and only when there is a
    // game to count. The per-game view below uses `player.<gameid>.` instead.
    const players =
      objects.length === 0
        ? []
        : await this.context.transport.list(this.context.store, PLAYER_OBJECT_PREFIX)
    // Bodies are then read by NAME through the cache, and only where the
    // listing's `sha256` says they changed.
    const listing = await listGamesFrom(this.context, objects, players, this.cache)
    let active: ActiveLobby | null = null
    const wanted = this.activeGameId
    if (wanted !== null) {
      if (objects.some((object) => object.name === gameObjectName(wanted))) {
        const playerObjects = await this.context.transport.list(
          this.context.store,
          playerObjectsPrefixFor(wanted),
        )
        active = await readLobby(this.context, wanted, {
          games: objects,
          players: playerObjects,
          cache: this.cache,
        })
      } else {
        // The game is GONE (deleted, or never there any more). That is not a
        // refusal: the view closes, and the cache drops the name on the next
        // listing. The caller decides whether to forget the resume pointer.
        this.activeGameId = null
        this.cache.forget(gameObjectName(wanted))
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

  // --- deleting a game ------------------------------------------------------

  /**
   * Work out what deleting one game would remove, and hold it for the panel's
   * confirmation. THREE narrow listings plus one point read (`deletionPlanFor`),
   * made only when the user asks — a poll tick never pays for it.
   *
   * A refusal (not a participant, no such game, an unreadable record) is stored
   * and shown like any other action's, and NO delete is offered.
   */
  planDeletion(gameId: string): Promise<DeletionUiState | null> {
    return this.act(async () => {
      const plan = await deletionPlanFor(this.context, gameId)
      this.setDeletion({
        gameId,
        plan,
        deleted: 0,
        total: plan.snapshots.length + plan.players.length + 1,
        absent: 0,
        running: false,
        failure: null,
        advice: null,
      })
      return this.deletion
    })
  }

  /**
   * DELETE the planned game — the record, every player object and every snapshot
   * of THAT game, record LAST (`deleteGames`), with progress published for each
   * object so a 100-object delete does not look frozen.
   *
   * Every request goes through the ONE request retrier, so a `429` waits out the
   * `Retry-After` the store sent instead of burning the window it was told to
   * leave. A refusal stops the run and is reported with the store's own code and
   * message, the ONE actionable sentence, and exactly what was and was not
   * removed — NEVER as a success.
   */
  deleteGame(gameId: string): Promise<DeletionUiState | null> {
    return this.act(async () => {
      const planned = this.deletion?.gameId === gameId ? this.deletion.plan : null
      const plan = planned ?? (await deletionPlanFor(this.context, gameId))
      const total = plan.snapshots.length + plan.players.length + 1
      this.setDeletion({
        gameId,
        plan,
        deleted: 0,
        total,
        absent: 0,
        running: true,
        failure: null,
        advice: null,
      })
      const transport = retryingContext(this.context, createRequestRetrier())
      try {
        await deleteGames(transport, gameId, {
          onProgress: (progress) => {
            this.setDeletion({
              gameId,
              plan,
              deleted: progress.done,
              total: progress.total,
              absent: progress.absent.length,
              running: true,
              failure: null,
              advice: null,
            })
          },
        })
        // Done: the game is GONE, so the panel has nothing left to confirm. The
        // listing refresh below is what makes it disappear from the list.
        this.setDeletion(null)
        if (this.activeGameId === gameId) {
          this.activeGameId = null
          this.active = null
        }
        await this.refresh()
        return this.deletion
      } catch (error) {
        // LOUD and EXACT: the store's refusal, the sentence that says what to do,
        // and the counts — never a claim of success (`AGENTS.md` rule 1).
        const refusal = error instanceof GameDeletionError ? error : null
        this.setDeletion({
          gameId,
          plan,
          deleted: refusal?.deleted.length ?? 0,
          total,
          absent: refusal?.absent.length ?? 0,
          running: false,
          failure: describeFailure(refusal?.error ?? error),
          advice: refusal === null ? null : deleteRefusalAdvice(refusal),
        })
        throw error
      }
    })
  }

  /** Give up on a delete before or after it ran (the panel's Cancel). */
  cancelDeletion(): void {
    this.setDeletion(null)
  }

  private setDeletion(next: DeletionUiState | null): void {
    this.deletion = next
    this.publish()
  }

  /**
   * Every action's own refresh is IMMEDIATE — it awaits its read here rather than
   * waiting for the next tick, so an action's result is on screen at once, and
   * the in-flight read also coalesces the tick that would have followed it. A
   * refusal is stored AND rethrown, so the panel can decide what to say about it.
   */
  private async act<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      this.failure = describeFailure(error)
      this.publish()
      throw error
    }
  }
}
