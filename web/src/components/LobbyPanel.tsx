/**
 * The lobby panel — the owner's three actions: **Create Multiplayer**,
 * **Join Multiplayer**, **Start Multiplayer (creator only)**.
 *
 * Two pieces, deliberately split:
 *
 *  - {@link LobbyPanelView} is PRESENTATIONAL: everything it draws comes from its
 *    props, so the rule that matters most ("Start appears only for the creator")
 *    is checkable without a browser or a store (`lobbyUi.test.ts` renders it with
 *    `react-dom/server`).
 *  - {@link LobbyPanel} is the container: it reads the ONE connection state
 *    `SetupScreen` owns, builds a lobby context, and calls the operations in
 *    `net/lobby.ts`. It never talks to the store directly — every read and write
 *    goes through that seam.
 *
 * The lobby is reachable only once a key is connected: with no identity the panel
 * renders a hint pointing at `ConnectPanel`, so a refusal there is never a blank
 * screen here.
 *
 * Out of scope, by design (S3): nothing polls, nothing watches the store, and no
 * game state is published. The list is refreshed on mount, after each action, and
 * by the explicit Refresh button.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { forgetActiveGame, readActiveGame } from '../net/activeGame'
import { describeFailure, type FailureDescription } from '../net/failure'
import { seatIndexOf } from '../net/gameRecord'
import {
  createGame,
  joinBlockedReason,
  joinGame,
  leaveGame,
  listGames,
  lobbyContext,
  readLobby,
  startGame,
  startRefusal,
  type ActiveLobby,
  type GameListing,
  type LobbyContext,
} from '../net/lobby'
import { createServerStoreTransport } from '../net/serverStore'
import type { MultiplayerHandoff } from '../net/sync'
import type { ConnectionState } from '../net/useConnection'
import { ServerStoreError, type StoreIdentity } from '../net/transport'

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

export function LobbyPanelView(props: LobbyPanelViewProps) {
  const { identity, active } = props

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
  const transport = useMemo(() => createServerStoreTransport(), [])
  const ctx = useMemo<LobbyContext | null>(
    () => (identity === null ? null : lobbyContext({ transport, identity })),
    [identity, transport],
  )

  const [displayName, setDisplayName] = useState('')
  const [listing, setListing] = useState<GameListing | null>(null)
  const [active, setActive] = useState<ActiveLobby | null>(null)
  const [failure, setFailure] = useState<FailureDescription | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (context: LobbyContext) => {
    setListing(await listGames(context))
  }, [])

  // Discovery on connect — once, and again only on an action or the Refresh
  // button. The lobby does not poll the store: WATCHING it is the game's job
  // (`net/sync.ts`), and a lobby that watched would be a second poll loop.
  useEffect(() => {
    if (ctx === null) {
      setListing(null)
      setActive(null)
      setFailure(null)
      setNotice(null)
      return
    }
    setDisplayName((current) => (current.length > 0 ? current : `${ctx.identity.label}'s game`))
    let cancelled = false
    void (async () => {
      try {
        const next = await listGames(ctx)
        if (cancelled) return
        setListing(next)
        // RESUME: a game this client was in before a reload is read back and
        // offered, so opening it ADOPTS its latest snapshot instead of starting
        // a fresh local game. A pointer to a game that is gone is forgotten.
        let remembered: string | null = null
        try {
          remembered = readActiveGame()
        } catch (error) {
          setFailure(describeFailure(error))
          return
        }
        if (remembered === null) return
        try {
          const lobby = await readLobby(ctx, remembered)
          if (cancelled) return
          setActive(lobby)
          setNotice(`Resuming "${lobby.record.displayName}" — press Enter game.`)
        } catch (error) {
          if (error instanceof ServerStoreError && error.code === 'not_found') {
            forgetActiveGame()
            return
          }
          if (!cancelled) setFailure(describeFailure(error))
        }
      } catch (error) {
        if (!cancelled) setFailure(describeFailure(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ctx])

  const run = useCallback(
    async (action: (context: LobbyContext) => Promise<void>) => {
      if (ctx === null) return
      setBusy(true)
      setFailure(null)
      setNotice(null)
      try {
        await action(ctx)
      } catch (error) {
        setFailure(describeFailure(error))
      } finally {
        setBusy(false)
      }
    },
    [ctx],
  )

  const onCreate = useCallback(() => {
    void run(async (context) => {
      const record = await createGame(context, { displayName, variant: variantName, maxPlayers })
      // The creator is a player too. Create wrote ONE object; this is the
      // creator's own join, a second object owned by the same client.
      await joinGame(context, record.gameId)
      setActive(await readLobby(context, record.gameId))
      await refresh(context)
      setNotice(`Created "${record.displayName}" (${record.gameId}). Waiting for players.`)
    })
  }, [run, displayName, variantName, maxPlayers, refresh])

  const onJoin = useCallback(
    (gameId: string) => {
      void run(async (context) => {
        const player = await joinGame(context, gameId)
        const lobby = await readLobby(context, gameId)
        setActive(lobby)
        await refresh(context)
        setNotice(`Joined "${lobby.record.displayName}" as ${player.label}.`)
      })
    },
    [run, refresh],
  )

  const onStart = useCallback(() => {
    void run(async (context) => {
      if (active === null || identity === null) return
      const started = await startGame(context, active.record.gameId)
      const lobby = await readLobby(context, started.gameId)
      setActive(lobby)
      await refresh(context)
      onStarted({
        record: lobby.record,
        players: lobby.players,
        identity,
        mode: 'host',
      })
    })
  }, [run, active, identity, refresh, onStarted])

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
    void run(async (context) => {
      if (active === null) return
      await leaveGame(context, active.record.gameId)
      forgetActiveGame()
      setActive(null)
      await refresh(context)
      setNotice(`Left "${active.record.displayName}".`)
    })
  }, [run, active, refresh])

  const onRefresh = useCallback(() => {
    void run(async (context) => {
      await refresh(context)
      setNotice('Game list refreshed.')
    })
  }, [run, refresh])

  const onClose = useCallback(() => {
    setActive(null)
    setNotice(null)
  }, [])

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
