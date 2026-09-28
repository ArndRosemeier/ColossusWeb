/**
 * The multiplayer status line — small, presentational, and the place the rules
 * a player needs to SEE are stated: whose turn it is, whether this client may
 * act, whether the poll is healthy, and whether a FORK happened.
 *
 * It renders from props only, so "it says whose turn it is" and "a fork is
 * surfaced, not swallowed" are checkable with `react-dom/server` and no store.
 * Neither sentence is invented here: a fork is `sync.ts`'s `formatFork` and a
 * failure is `failure.ts`'s `formatFailureStatus`, both carried on
 * `PollStatus.detail`, so the warning and the state it warns about can never
 * disagree. A `429` therefore reads as "the store is busy — slowing down",
 * with the wait the service itself asked for.
 */

import type { FailureDescription } from '../net/failure'
import type { PollStatus } from '../net/sync'

export interface MultiplayerStatusProps {
  /** This client's seat index, or -1 for a spectator. */
  seat: number
  seatCount: number
  /** A human label for the current decision, e.g. `Rd01's turn` or an engagement. */
  turnLabel: string
  myTurn: boolean
  gameOver: boolean
  status: PollStatus | null
  failure: FailureDescription | null
}

function pollLabel(status: PollStatus | null): string {
  if (status === null) return 'connecting…'
  if (status.phase === 'stopped') return 'sync stopped'
  if (status.phase === 'error') {
    // A rate limit is PACING, not a broken sync: the loop is doing what the
    // store asked, so it must not read as a failure the player should act on.
    if (status.lastError?.code === 'rate_limited') return 'store busy — slowing down'
    return status.failures > 1
      ? `sync error (retry ${status.failures})`
      : 'sync error'
  }
  if (status.phase === 'idle') return 'sync idle'
  return 'synced'
}

export function MultiplayerStatus(props: MultiplayerStatusProps) {
  const { seat, seatCount, myTurn, gameOver, status, failure } = props
  // The job's own warning — the fork sentence, or the failure that just
  // happened. A FAILURE is rendered below from the description itself (title,
  // code and the service's message), so the same sentence is not printed twice.
  const detail = status?.detail ?? null
  const showDetail = detail !== null && failure === null
  const seatLabel =
    seat >= 0 ? `Seat ${seat + 1}/${seatCount}` : `Watching (${seatCount} seats)`

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
      <span className="muted">· {pollLabel(status)}</span>
      {showDetail && (
        <span className="connect-failure" role="alert">
          {detail}
        </span>
      )}
      {failure && (
        <span className="connect-failure" role="alert">
          {failure.title}{' '}
          {failure.retryAfterSeconds === undefined ? null : (
            <>retrying in {failure.retryAfterSeconds}s </>
          )}
          <span className="connect-code">{failure.code}</span> {failure.message}
        </span>
      )}
    </span>
  )
}
