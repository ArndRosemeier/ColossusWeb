/**
 * The online status line — small, presentational, and the place the rules a
 * player needs to SEE are stated: whose turn it is, whether this client may act,
 * whether the connection is up, and who is away.
 *
 * It renders from props only, so "it says whose turn it is" and "a refusal is
 * surfaced, not swallowed" are checkable with `react-dom/server`
 * (`multiplayerStatus.test.ts`). A failure's words are `net/failure.ts`'s.
 */

import type { FailureDescription } from '../net/failure'
import type { ConnectionPhase } from '../net/session'

export interface MultiplayerStatusProps {
  /** This client's seat index, or -1 for a spectator. */
  seat: number
  seatCount: number
  roomCode: string | null
  isHost: boolean
  /** Seated players whose connection is gone right now. */
  away: readonly string[]
  /** A human label for the current decision, e.g. `Rd01's turn` or an engagement. */
  turnLabel: string
  myTurn: boolean
  gameOver: boolean
  connection: ConnectionPhase
  failure: FailureDescription | null
}

function connectionLabel(props: MultiplayerStatusProps): string {
  switch (props.connection) {
    case 'online':
      return props.roomCode === null ? 'room closed' : `room ${props.roomCode}${props.isHost ? ' · host' : ''}`
    case 'connecting':
      return 'connecting…'
    case 'reconnecting':
      return 'connection lost — reconnecting…'
    case 'idle':
      return 'offline'
  }
}

export function MultiplayerStatus(props: MultiplayerStatusProps) {
  const { seat, seatCount, myTurn, gameOver, failure } = props
  const seatLabel = seat >= 0 ? `Seat ${seat + 1}/${seatCount}` : `Watching (${seatCount} seats)`

  return (
    <span className="mp-status" data-testid="multiplayer-status">
      <span className="muted">{seatLabel}</span>
      {!gameOver && <span className="muted">· {props.turnLabel}</span>}
      {gameOver && <span className="winner">· game over</span>}
      {!gameOver &&
        (myTurn ? (
          <span className="mp-yourturn">your turn</span>
        ) : (
          <span className="muted mp-readonly">read-only</span>
        ))}
      <span className="muted" data-connection={props.connection}>
        · {connectionLabel(props)}
      </span>
      {props.away.length > 0 && <span className="muted mp-away">· away: {props.away.join(', ')}</span>}
      {failure && (
        <span className="connect-failure" role="alert">
          {failure.title} <span className="connect-code">{failure.code}</span> {failure.message}
        </span>
      )}
    </span>
  )
}
