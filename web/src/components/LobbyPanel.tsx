/**
 * The online lobby — Create, Join, Start, and getting back into a game.
 *
 * Everything travels over the ONE live GameHub connection (`net/session.ts`):
 * the room list is pushed by the server, a join appears on everyone's screen the
 * moment it happens, and Start moves every player into the game together. There
 * is no key to paste; a player is a name plus the browser's stable token
 * (`net/identity.ts`).
 *
 * Two pieces, deliberately split:
 *
 *  - {@link LobbyPanelView} is PRESENTATIONAL: everything it draws comes from its
 *    props, so "Start appears only for the host" and "the host is TOLD why Start
 *    is blocked" are checkable with `react-dom/server` (`lobbyUi.test.ts`).
 *  - {@link LobbyPanel} is the container: it drives the session.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { readActiveGame, forgetActiveGame, type ActiveGame } from '../net/activeGame'
import { describeFailure, type FailureDescription } from '../net/failure'
import { cleanName, saveLocalPlayerName, type LocalPlayer } from '../net/identity'
import { seatOf, startRefusal, type RoomWorld } from '../net/room'
import type { ConnectionPhase, HubSession, LobbyRoom } from '../net/session'

/** `?room=CODE` — the lobby page's Join link (`docs/LOBBY.md` in the gameserver repo). */
export function roomCodeFromUrl(search: string): string | null {
  const code = new URLSearchParams(search).get('room')
  return code !== null && /^[A-Za-z0-9]{4,12}$/.test(code) ? code.toUpperCase() : null
}

export function roomLink(code: string, href: string): string {
  const url = new URL(href)
  url.search = `?room=${encodeURIComponent(code)}`
  url.hash = ''
  return url.toString()
}

export interface LobbyPanelViewProps {
  connection: ConnectionPhase
  playerName: string
  onPlayerNameChange: (value: string) => void
  myToken: string
  variantName: string
  maxPlayers: number
  gameName: string
  onGameNameChange: (value: string) => void
  rooms: readonly LobbyRoom[]
  /** The room this browser is in, or null. */
  room: { code: string; world: RoomWorld; isHost: boolean; link: string } | null
  /** A remembered game whose room is not joined (closed, or re-opened elsewhere). */
  resume: { copy: ActiveGame; live: LobbyRoom | null } | null
  failure: FailureDescription | null
  busy: boolean
  onCreate: () => void
  onJoin: (code: string) => void
  onStart: () => void
  onEnter: () => void
  onLeave: () => void
  onReopen: () => void
  onForget: () => void
}

function connectionLabel(phase: ConnectionPhase): string {
  switch (phase) {
    case 'idle':
      return 'Not connected'
    case 'connecting':
      return 'Connecting to the game server…'
    case 'reconnecting':
      return 'Connection lost — reconnecting…'
    case 'online':
      return 'Online · the list updates live'
  }
}

export function LobbyPanelView(props: LobbyPanelViewProps) {
  const { room, resume } = props
  const named = cleanName(props.playerName).length > 0
  const online = props.connection === 'online'
  const [code, setCode] = useState('')

  return (
    <section className="setup-panel lobby-panel" aria-label="Online lobby">
      <h2>Play online</h2>
      <p className="lobby-freshness" data-phase={props.connection}>
        <span className="lobby-live-dot" aria-hidden="true" />
        {connectionLabel(props.connection)}
      </p>
      <div className="connect-row">
        <input
          value={props.playerName}
          aria-label="Your name"
          placeholder="Your name"
          maxLength={32}
          onChange={(event) => props.onPlayerNameChange(event.target.value)}
        />
      </div>

      {room ? (
        <RoomView {...props} room={room} />
      ) : (
        <>
          {resume && (
            <div className="lobby-active" aria-label="Your game">
              <p className="lobby-game-title">
                <strong>{resume.copy.world.displayName}</strong>{' '}
                <span className="muted">
                  {resume.copy.world.variant} · {resume.copy.world.status}
                  {resume.copy.world.status === 'started' ? ` · move ${resume.copy.world.rev}` : ''}
                </span>
              </p>
              {resume.live ? (
                <p className="hint">This game is open in room {resume.live.code}.</p>
              ) : (
                <p className="hint">
                  Its room has closed. The game is saved in this browser — re-open it and the other
                  players can rejoin their seats from the list.
                </p>
              )}
              <div className="setup-actions">
                {resume.live ? (
                  <button
                    type="button"
                    className="primary"
                    disabled={props.busy || !online}
                    onClick={() => props.onJoin(resume.live!.code)}
                  >
                    Rejoin
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    disabled={props.busy || !online || seatOf(resume.copy.world, props.myToken) < 0}
                    onClick={props.onReopen}
                  >
                    Re-open game
                  </button>
                )}
                <button type="button" className="ghost" disabled={props.busy} onClick={props.onForget}>
                  Forget it
                </button>
              </div>
            </div>
          )}

          <div className="lobby-create">
            <h3>Create a game</h3>
            <div className="connect-row">
              <input
                value={props.gameName}
                aria-label="Game name"
                placeholder="My game"
                maxLength={32}
                onChange={(event) => props.onGameNameChange(event.target.value)}
              />
              <button
                type="button"
                className="primary"
                onClick={props.onCreate}
                disabled={props.busy || !online || !named || props.gameName.trim().length === 0}
              >
                Create
              </button>
            </div>
            <p className="hint">
              Variant {props.variantName} · up to {props.maxPlayers} players.
              {named ? '' : ' Enter your name first.'}
            </p>
          </div>

          <div className="lobby-join">
            <h3>Join a game</h3>
            {props.rooms.length === 0 ? (
              <p className="hint">{online ? 'No open games right now. Create one.' : 'Waiting for the server…'}</p>
            ) : (
              <ul className="lobby-games">
                {props.rooms.map((game) => {
                  const full = game.meta.status === 'lobby' && game.meta.members >= game.meta.maxPlayers
                  const mine = resume?.copy.world.gameId === game.meta.gameId
                  return (
                    <li key={game.code} className="lobby-game" data-code={game.code}>
                      <span className="lobby-game-name">
                        {game.name}
                        {mine ? ' (yours)' : ''}
                      </span>
                      <span className="muted">
                        {game.meta.variant} · {game.meta.members}/{game.meta.maxPlayers}
                        {game.meta.status === 'started' ? ' · started' : ''} · {game.code}
                      </span>
                      <button
                        type="button"
                        className="primary"
                        disabled={props.busy || !named || (full && !mine)}
                        onClick={() => props.onJoin(game.code)}
                      >
                        {mine ? 'Rejoin' : game.meta.status === 'started' ? 'Watch' : full ? 'Full' : 'Join'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="connect-row">
              <input
                value={code}
                aria-label="Room code"
                placeholder="Room code"
                maxLength={12}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
              <button
                type="button"
                className="ghost"
                disabled={props.busy || !online || !named || code.trim().length < 4}
                onClick={() => props.onJoin(code.trim())}
              >
                Join by code
              </button>
            </div>
          </div>
        </>
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

function RoomView(props: LobbyPanelViewProps & { room: NonNullable<LobbyPanelViewProps['room']> }) {
  const { world, isHost, code } = props.room
  const refusal = isHost && world.status === 'lobby' ? startRefusal(world) : null
  const seat = seatOf(world, props.myToken)
  return (
    <div className="lobby-active">
      <p className="lobby-game-title">
        <strong>{world.displayName}</strong>{' '}
        <span className="muted">
          room {code} · {world.variant} · {world.status} ·{' '}
          {world.status === 'started' ? world.seats.length : world.members.length}/{world.maxPlayers} players
        </span>
      </p>
      <p className="hint">
        Invite link: <code className="lobby-link">{props.room.link}</code>
      </p>
      <ul className="lobby-players">
        {world.members.map((member) => {
          const s = seatOf(world, member.token)
          return (
            <li key={member.token} data-online={member.conn !== null}>
              <span className={member.conn !== null ? 'lobby-online' : 'lobby-away'} aria-hidden="true">
                ●
              </span>{' '}
              {member.name || 'Player'}
              {member.token === props.myToken ? ' (you)' : ''}
              {member.token === world.creatorToken ? ' · creator' : ''}
              {world.status === 'started' ? (s >= 0 ? ` · seat ${s + 1}` : ' · watching') : ''}
              {member.conn === null ? ' · away' : ''}
            </li>
          )
        })}
      </ul>
      <div className="setup-actions">
        {isHost && world.status === 'lobby' && (
          <button
            type="button"
            className="primary"
            onClick={props.onStart}
            disabled={props.busy || refusal !== null}
            title={refusal?.message}
          >
            Start game
          </button>
        )}
        {!isHost && world.status === 'lobby' && (
          <span className="muted">Waiting for the host to start…</span>
        )}
        {world.status === 'started' && (
          <button type="button" className="primary" onClick={props.onEnter} disabled={props.busy}>
            {seat >= 0 ? 'Enter game' : 'Watch game'}
          </button>
        )}
        {/* The blocking reason is NEVER only a greyed-out button. */}
        {refusal && (
          <span className="muted lobby-refusal">
            {refusal.code}: {refusal.message}
          </span>
        )}
        <button type="button" className="ghost" onClick={props.onLeave} disabled={props.busy}>
          Leave
        </button>
      </div>
    </div>
  )
}

interface Props {
  session: HubSession
  player: LocalPlayer
  onPlayerChange: (player: LocalPlayer) => void
  variantName: string
  maxPlayers: number
  /** Open the started game this browser is in. */
  onEnter: () => void
}

export function LobbyPanel({ session, player, onPlayerChange, variantName, maxPlayers, onEnter }: Props) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [gameName, setGameName] = useState(() => (player.name ? `${player.name}'s game` : ''))
  const [busy, setBusy] = useState(false)
  const [localFailure, setLocalFailure] = useState<FailureDescription | null>(null)
  const [copy, setCopy] = useState<ActiveGame | null>(() => {
    try {
      return readActiveGame()
    } catch (error) {
      queueMicrotask(() => setLocalFailure(describeFailure(error)))
      return null
    }
  })
  const autoEntered = useRef(false)
  /** The copy as it was when the panel opened: where a resume starts from. */
  const initialCopy = useRef(copy)

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true)
    setLocalFailure(null)
    try {
      await action()
    } catch {
      // The session put the refusal on its snapshot; `failure` renders it.
    } finally {
      setBusy(false)
    }
  }, [])

  // Connect, then go straight back into the game this browser was in — or into
  // the room an invite link names.
  useEffect(() => {
    const linked = roomCodeFromUrl(globalThis.location?.search ?? '')
    void run(async () => {
      await session.start()
      if (session.getSnapshot().code !== null) return
      const saved = initialCopy.current
      const target = linked ?? saved?.code ?? null
      if (target !== null && target.length > 0) {
        if (saved !== null) session.restoreCopy(saved.world)
        try {
          await session.join(target)
        } catch {
          // A closed room is not an error worth shouting about on resume: the
          // copy is offered for re-opening instead.
          if (linked === null) setLocalFailure(null)
        }
      }
    })
  }, [session, run])

  // Keep the remembered copy in step with the live world.
  useEffect(() => {
    if (snap.world !== null && snap.code !== null) setCopy({ code: snap.code, world: snap.world })
  }, [snap.world, snap.code])

  // Start moves everyone in: a seated player enters the game on its own.
  useEffect(() => {
    if (autoEntered.current) return
    if (snap.code === null || snap.world?.status !== 'started') return
    if (seatOf(snap.world, player.token) < 0) return
    autoEntered.current = true
    onEnter()
  }, [snap.code, snap.world, player.token, onEnter])

  const onPlayerNameChange = useCallback(
    (value: string) => {
      const next = saveLocalPlayerName(player, value)
      session.setPlayer(next)
      onPlayerChange({ token: next.token, name: value.slice(0, 32) })
    },
    [player, session, onPlayerChange],
  )

  const room =
    snap.code !== null && snap.world !== null
      ? {
          code: snap.code,
          world: snap.world,
          isHost: snap.isHost,
          link: roomLink(snap.code, globalThis.location?.href ?? 'https://apps.futuremagic.de/ColossusWeb/'),
        }
      : null
  const resume =
    room === null && copy !== null ? { copy, live: session.findRoomFor(copy.world.gameId) } : null

  return (
    <LobbyPanelView
      connection={snap.connection}
      playerName={player.name}
      onPlayerNameChange={onPlayerNameChange}
      myToken={player.token}
      variantName={variantName}
      maxPlayers={maxPlayers}
      gameName={gameName}
      onGameNameChange={setGameName}
      rooms={snap.rooms}
      room={room}
      resume={resume}
      failure={localFailure ?? snap.failure}
      busy={busy}
      onCreate={() =>
        void run(() => session.create({ displayName: gameName, variant: variantName, maxPlayers }))
      }
      onJoin={(code) => void run(() => session.join(code))}
      onStart={() => {
        autoEntered.current = true
        onEnter()
      }}
      onEnter={onEnter}
      onLeave={() =>
        void run(async () => {
          await session.leave()
          setCopy(null)
        })
      }
      onReopen={() => {
        if (copy !== null) void run(() => session.reopen(copy.world))
      }}
      onForget={() => {
        forgetActiveGame()
        setCopy(null)
      }}
    />
  )
}
