/**
 * The lobby panel — the owner's three actions: **Create Multiplayer**,
 * **Join Multiplayer**, **Start Multiplayer (creator only)**.
 *
 * Two pieces, deliberately split:
 *
 *  - {@link LobbyPanelView} is PRESENTATIONAL: everything it draws comes from its
 *    props, so the rules that matter most ("Start appears only for the creator",
 *    "the creator is TOLD why Start is blocked") are checkable without a browser
 *    or a store (`lobbyUi.test.ts` renders it with `react-dom/server`).
 *  - {@link LobbyPanel} is the container: it reads the ONE connection state
 *    `SetupScreen` owns, builds a lobby context, and calls the operations in
 *    `net/lobby.ts`. It never talks to the store directly — every read and write
 *    goes through that seam.
 *
 * The lobby is reachable only once a key is connected: with no identity the panel
 * renders a hint pointing at `ConnectPanel`, so a refusal there is never a blank
 * screen here.
 *
 * ## The list is LIVE (S4)
 *
 * This panel used to refresh once on mount, then only on an action or the
 * explicit Refresh button — and the owner's first live test found the cost: the
 * creator never saw a joiner arrive, so Start (which needs two joined players as
 * the creator's view sees them) stayed disabled and "there is no way to start"
 * was really "the lobby never refreshed". So the panel now WATCHES the store,
 * through `net/lobbyWatcher.ts`: the lobby's job on the session's ONE poll loop
 * (~5s, visible-only, backoff on error, no timer of its own — `sync.ts`'s
 * `pollLoop` owns the timer). {@link LobbyFreshness} says so on screen, so a list
 * that has not changed does not look dead, and a failed read is loud, not silent.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { forgetActiveGame, rememberActiveGame } from '../net/activeGame'
import type { FailureDescription } from '../net/failure'
import { seatIndexOf } from '../net/gameRecord'
import {
  joinBlockedReason,
  startRefusal,
  type ActiveLobby,
  type GameListing,
} from '../net/lobby'
import { LobbyStore, LobbyWatcher, type LobbyData } from '../net/lobbyWatcher'
import { createServerStoreTransport } from '../net/serverStore'
import { serverStoreName } from '../net/storeName'
import {
  browserVisibility,
  usePolledStatus,
  type MultiplayerHandoff,
  type PollHandle,
  type PollStatus,
} from '../net/sync'
import type { ConnectionState } from '../net/useConnection'
import type { ServerStoreTransport, StoreIdentity } from '../net/transport'

export interface LobbyPanelViewProps {
  /** The connected identity, or `null` when no key is connected yet. */
  identity: StoreIdentity | null
  variantName: string
  maxPlayers: number
  displayName: string
  onDisplayNameChange: (value: string) => void
  listing: GameListing | null
  /** The game this client is currently inside, if any. */
  active: ActiveLobby | null
  failure: FailureDescription | null
  notice: string | null
  /** The watching loop's health, for the freshness signal. `null` while none runs. */
  pollStatus: PollStatus | null
  busy: boolean
  onCreate: () => void
  onJoin: (gameId: string) => void
  onStart: () => void
  /** Enter a STARTED game: adopt the latest snapshot rather than start fresh. */
  onEnter: () => void
  onLeave: () => void
  onRefresh: () => void
  onClose: () => void
}

/**
 * The freshness signal: what a person needs in order to tell "nothing has
 * changed yet" from "this screen is dead". It renders the loop's own state — it
 * makes no request of its own — and every sentence it can say is a function of
 * that state, so a pin can assert the wording as well as the presence.
 *
 * A rate limit reads as PACING, not as a broken lobby: the store said "slow
 * down", the loop is waiting the `Retry-After` out, and the sentence says so
 * WITH the wait. The failure detail below still carries the service's own
 * message, so the refusal is never hidden.
 */
export interface LobbyFreshnessProps {
  readonly status: PollStatus | null
  readonly pollSeconds: number
  /** The loop's last refusal, so its SENTENCE can be the fresh one. */
  readonly failure?: FailureDescription | null
}

export function LobbyFreshness(props: LobbyFreshnessProps) {
  const { status } = props
  const phase = status?.phase ?? 'starting'
  const rateLimited = status?.lastError?.code === 'rate_limited'
  const retryAfter = props.failure?.retryAfterSeconds
  const label =
    status === null
      ? 'Checking the store…'
      : status.phase === 'error'
        ? rateLimited
          ? `the store is busy — slowing down${
              retryAfter === undefined ? '' : `, retrying in ${retryAfter}s`
            }`
          : `list update failed — retrying (${status.failures} in a row, last tried ${props.pollSeconds}s ago)`
        : status.phase === 'stopped'
          ? 'Not watching the store any more'
          : status.phase === 'idle'
            ? 'Paused — this tab is hidden'
            : status.polls === 0
              ? 'Watching the store…'
              : `live · updated ${props.pollSeconds}s ago`
  return (
    <p className="lobby-freshness" data-phase={phase}>
      <span className="lobby-live-dot" aria-hidden="true" />
      {label}
    </p>
  )
}

/** Whole seconds since `iso`, or 0 when there is no read yet. */
function secondsAgo(iso: string | null, now: number): number {
  if (iso === null) return 0
  return Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
}

/**
 * The lobby's own clock. It exists only so the freshness line can count, and it
 * ticks only while the tab is visible — a hidden tab neither polls nor redraws.
 * The visibility source is `sync.ts`'s ONE rule rather than a second
 * `visibilitychange` listener of the panel's own.
 */
function useLobbyPollSeconds(status: PollStatus | null, live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  const polling = status?.phase === 'polling'

  useEffect(() => {
    if (!live || !polling) return
    const source = browserVisibility()
    let timer: ReturnType<typeof setInterval> | null = null

    const schedule = () => {
      if (timer !== null) clearInterval(timer)
      timer = source.visible() ? setInterval(() => setNow(Date.now()), 1000) : null
      setNow(Date.now())
    }
    schedule()
    const unsubscribe = source.subscribe(schedule)
    return () => {
      if (timer !== null) clearInterval(timer)
      unsubscribe()
    }
  }, [live, polling])

  return secondsAgo(status?.lastPolledAt ?? null, now)
}

export function LobbyPanelView(props: LobbyPanelViewProps) {
  const { identity, active } = props
  const pollSeconds = useLobbyPollSeconds(props.pollStatus, identity !== null)

  if (!identity) {
    return (
      <section className="setup-panel lobby-panel" aria-label="Multiplayer lobby">
        <h2>Multiplayer</h2>
        <p className="hint">
          Connect a ServerStore key above first — Create, Join and Start all need an identity.
        </p>
      </section>
    )
  }

  const isCreator = active !== null && active.record.creator.id === identity.id
  const startBlocked =
    isCreator && active !== null
      ? startRefusal(active.record, identity, active.players.length)
      : null
  // A spectator (joined but not seated) is told so; they are never treated as
  // seat 0. `seatOrder` is written at Start, so it is meaningless in the lobby.
  const seat = active === null ? -1 : seatIndexOf(active.record, identity.id)

  return (
    <section className="setup-panel lobby-panel" aria-label="Multiplayer lobby">
      <h2>Multiplayer</h2>

      {active ? (
        <div className="lobby-active">
          <p className="lobby-game-title">
            <strong>{active.record.displayName}</strong>{' '}
            <span className="muted">
              id {active.record.gameId} · {active.record.variant} · {active.record.status} ·{' '}
              {active.players.length}/{active.record.maxPlayers} players
            </span>
          </p>
          <p className="muted">
            Created by {active.record.creator.label}
            {isCreator ? ' (you)' : ''}
          </p>
          {active.players.length > 0 ? (
            <ul className="lobby-players">
              {active.players.map((player) => (
                <li key={player.playerId}>
                  {player.label}
                  {player.playerId === identity.id ? ' (you)' : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Nobody has joined yet.</p>
          )}
          <LobbyFreshness
            status={props.pollStatus}
            pollSeconds={pollSeconds}
            failure={props.failure}
          />
          <div className="setup-actions">
            {isCreator && active.record.status === 'lobby' && (
              <button
                type="button"
                className="primary"
                onClick={props.onStart}
                disabled={props.busy || startBlocked !== null}
                title={startBlocked?.message}
              >
                Start Multiplayer (creator)
              </button>
            )}
            {active.record.status === 'started' && seat >= 0 && (
              <button
                type="button"
                className="primary"
                onClick={props.onEnter}
                disabled={props.busy}
              >
                Enter game
              </button>
            )}
            {active.record.status === 'started' && seat < 0 && (
              <span className="muted">
                Watching — you are not one of this game&apos;s {active.record.seatOrder.length}{' '}
                seats.
              </span>
            )}
            {/*
              The blocking reason is NEVER only a greyed-out button: the creator
              with one player sees the rule working, in words, and the same text
              is on the button's `title`. It clears by itself the moment the
              second player's join appears in the list — the rule is re-evaluated
              from the refreshed players, not remembered.
            */}
            {startBlocked && (
              <span className="muted lobby-refusal">
                {startBlocked.code}: {startBlocked.message}
              </span>
            )}
            <button type="button" className="ghost" onClick={props.onLeave} disabled={props.busy}>
              Leave game
            </button>
            <button type="button" className="ghost" onClick={props.onClose} disabled={props.busy}>
              Back to games
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="lobby-create">
            <h3>Create Multiplayer</h3>
            <div className="connect-row">
              <input
                value={props.displayName}
                aria-label="Multiplayer game name"
                placeholder="My game"
                onChange={(event) => props.onDisplayNameChange(event.target.value)}
              />
              <button
                type="button"
                className="primary"
                onClick={props.onCreate}
                disabled={props.busy || props.displayName.trim().length === 0}
              >
                Create Multiplayer
              </button>
            </div>
            <p className="hint">
              Variant {props.variantName} · up to {props.maxPlayers} players. You will join your own
              game as its first player.
            </p>
          </div>

          <div className="lobby-join">
            <h3>Join Multiplayer</h3>
            {props.listing === null ? (
              <p className="hint">Reading the game list…</p>
            ) : props.listing.games.length === 0 ? (
              <p className="hint">No games in the store yet. Create one.</p>
            ) : (
              <ul className="lobby-games">
                {props.listing.games.map((game) => {
                  const blocked = joinBlockedReason(game.record, game.playerCount)
                  const mine = game.record.creator.id === identity.id
                  return (
                    <li key={game.objectName} className="lobby-game">
                      <span className="lobby-game-name">
                        {game.record.displayName}
                        {mine ? ' (yours)' : ''}
                      </span>
                      <span className="muted">
                        {game.record.variant} · {game.playerCount}/{game.record.maxPlayers} ·{' '}
                        {game.record.creator.label}
                        {game.record.status === 'started' ? ' · started' : ''}
                      </span>
                      <button
                        type="button"
                        className={game.alreadyJoined ? 'ghost' : 'primary'}
                        disabled={props.busy || (!game.alreadyJoined && blocked !== null)}
                        title={blocked?.message}
                        onClick={() => props.onJoin(game.gameId)}
                      >
                        {game.alreadyJoined ? 'Open' : blocked ? 'Unavailable' : 'Join Multiplayer'}
                      </button>
                      {blocked && !game.alreadyJoined && (
                        <span className="muted lobby-refusal">
                          {blocked.code}: {blocked.message}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {props.listing !== null && props.listing.unreadable.length > 0 && (
              <ul className="lobby-unreadable">
                {props.listing.unreadable.map((game) => (
                  <li key={game.objectName} role="alert">
                    {game.objectName}: {game.failure.title}{' '}
                    <span className="connect-code">{game.failure.code}</span>{' '}
                    {game.failure.message}
                  </li>
                ))}
              </ul>
            )}
            <LobbyFreshness
              status={props.pollStatus}
              pollSeconds={pollSeconds}
              failure={props.failure}
            />
            <div className="setup-actions">
              <button type="button" className="ghost" onClick={props.onRefresh} disabled={props.busy}>
                Refresh games
              </button>
            </div>
          </div>
        </>
      )}

      {props.notice && (
        <p className="lobby-notice" role="status">
          {props.notice}
        </p>
      )}
      {props.failure && (
        <p className="connect-failure" role="alert">
          {props.failure.title} <span className="connect-code">{props.failure.code}</span>{' '}
          {props.failure.message}
        </p>
      )}
    </section>
  )
}

interface Props {
  /** The ONE connection state, owned by `SetupScreen`. */
  connection: ConnectionState
  variantName: string
  maxPlayers: number
  /**
   * The started game to open. `mode` decides who writes the first snapshot:
   * the creator (`host`) publishes it, everyone else (`adopt`) reads it.
   */
  onStarted: (handoff: MultiplayerHandoff) => void
}

export function LobbyPanel({ connection, variantName, maxPlayers, onStarted }: Props) {
  const identity = connection.identity
  /**
   * The connected id as a PRIMITIVE, and the watcher's inputs are primitives
   * only. A `useMemo` does not guarantee a stable identity (React may discard a
   * result and recompute it — measured here under `StrictMode`, which `main.tsx`
   * keeps ON in production), and a starter depending on such an object would be
   * a new function after every recomputation: the effect would restart the loop
   * and abandon a live one. A string cannot be recomputed into a different
   * identity, so the loop starts exactly once per real connection.
   */
  const identityId = identity?.id ?? null
  const identityLabel = identity?.label ?? ''
  // `useState`, not `useMemo`, for the same reason: ONE store client, and ONE
  // external store whose subscribe/getSnapshot are stable from the first render.
  const [transport] = useState<ServerStoreTransport>(() => createServerStoreTransport())
  const [store] = useState(() => new LobbyStore())

  const [displayName, setDisplayName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The panel renders the STORE's snapshot; the watcher does every read.
  const data: LobbyData = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const listing = identityId === null ? null : data.listing
  const active = identityId === null ? null : data.active

  const polled = usePolledStatus(
    useCallback(
      (report: (status: PollStatus) => void): PollHandle | null => {
        if (identityId === null) return null
        const watcher = new LobbyWatcher({
          transport,
          // The identity built from the PRIMITIVES this callback depends on, so
          // the reader can never be handed one whose id went null — and this
          // callback cannot change identity under a live loop.
          identity: {
            id: identityId,
            label: identityLabel,
            // The watcher's own reads never consult these, and a key may be
            // scoped to many stores; the ONE store this panel uses is `store`.
            stores: [serverStoreName()],
            perms: ['read', 'write'],
          },
          store: serverStoreName(),
          onStatus: (status) => report(status),
        })
        // Attach BEFORE the first tick, so the first read reaches React.
        store.set(watcher)
        watcher.start()
        return {
          stop: () => {
            watcher.close()
            store.clear(watcher)
          },
        }
      },
      // PRIMITIVES only: see the note above.
      [identityId, identityLabel, transport, store],
    ),
  )
  // A refusal the watcher could not even start on is the hook's; anything the
  // watcher read or an action produced is on the store.
  const failure = identityId === null ? polled.failure : data.failure
  const pollStatus = polled.status

  useEffect(() => {
    if (identityId === null || identity === null) {
      setNotice(null)
      setDisplayName('')
      return
    }
    const label = identity.label
    setDisplayName((current) => (current.length > 0 ? current : `${label}'s game`))
    // RESUME: the store's watcher read the resume pointer at construction and its
    // FIRST tick is already reading that game back, so a game this client was in
    // before a reload is offered instead of starting a fresh local one. A pointer
    // to a game that is gone reports `not_found`, which is forgotten here rather
    // than re-read; anything else is already on the error surface.
    void (async () => {
      const watcher = store.current()
      if (watcher === null) return
      await watcher.refresh()
      store.refresh()
      if (watcher.getData().failure?.code === 'not_found') {
        forgetActiveGame()
        await watcher.setActiveGame(null)
        store.refresh()
        return
      }
      const resumed = watcher.getData().active
      if (resumed !== null) {
        setNotice(`Resuming "${resumed.record.displayName}" — press Enter game.`)
      }
    })()
    // The ID, not the memoised ctx: a memo may be recomputed with equal contents,
    // and re-running this effect on that would re-issue the notice for nothing.
  }, [identityId, identity, store])

  const run = useCallback(
    async (action: (target: LobbyWatcher) => Promise<void>) => {
      const watcher = store.current()
      if (watcher === null) return
      setBusy(true)
      setNotice(null)
      try {
        await action(watcher)
      } catch {
        // The watcher stored the refusal and published it; the panel only has to
        // stop being busy. Nothing is swallowed — `data.failure` renders it.
      } finally {
        setBusy(false)
        // An action's own read has landed; show it even if a tick is in flight.
        store.refresh()
      }
    },
    [store],
  )

  const onCreate = useCallback(() => {
    void run(async (target) => {
      await target.create({ displayName, variant: variantName, maxPlayers })
      const record = target.getData().active!.record
      rememberActiveGame(record.gameId)
      setNotice(`Created "${record.displayName}" (${record.gameId}). Waiting for players.`)
    })
  }, [run, displayName, variantName, maxPlayers])

  const onJoin = useCallback(
    (gameId: string) => {
      void run(async (target) => {
        await target.join(gameId)
        const lobby = target.getData().active!
        rememberActiveGame(gameId)
        setNotice(`Joined "${lobby.record.displayName}".`)
      })
    },
    [run],
  )

  const onStart = useCallback(() => {
    void run(async (target) => {
      if (identity === null) return
      await target.startGame()
      const lobby = target.getData().active
      if (lobby === null) return
      onStarted({
        record: lobby.record,
        players: lobby.players,
        identity,
        mode: 'host',
      })
    })
  }, [run, identity, onStarted])

  const onEnter = useCallback(() => {
    if (active === null || identity === null) return
    onStarted({
      record: active.record,
      players: active.players,
      identity,
      mode: 'adopt',
    })
  }, [active, identity, onStarted])

  const onLeave = useCallback(() => {
    void run(async (target) => {
      const label = target.getData().active?.record.displayName ?? 'the game'
      await target.leaveGame()
      forgetActiveGame()
      setNotice(`Left "${label}".`)
    })
  }, [run])

  const onRefresh = useCallback(() => {
    void run(async (target) => {
      await target.refresh()
      setNotice('Game list refreshed.')
    })
  }, [run])

  const onClose = useCallback(() => {
    store.current()?.back()
    store.refresh()
    setNotice(null)
  }, [store])

  return (
    <LobbyPanelView
      identity={identity}
      variantName={variantName}
      maxPlayers={maxPlayers}
      displayName={displayName}
      onDisplayNameChange={setDisplayName}
      listing={listing}
      active={active}
      failure={failure}
      notice={notice}
      pollStatus={pollStatus}
      busy={busy}
      onCreate={onCreate}
      onJoin={onJoin}
      onStart={onStart}
      onEnter={onEnter}
      onLeave={onLeave}
      onRefresh={onRefresh}
      onClose={onClose}
    />
  )
}

