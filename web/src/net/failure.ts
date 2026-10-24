/**
 * Turning a multiplayer failure into something a person can read — WITHOUT
 * hiding the server's own words.
 *
 * GameHub refuses with a short `code` (`room_full`, `no_such_room`,
 * `rate_limited`, …); this client adds its own (`hub_not_configured`,
 * `not_your_turn`, `stale_move`, …). Both survive into the UI verbatim
 * (`AGENTS.md` rule 1: a failure is never silent, and errors are visible through
 * the app's one error surface).
 */

/** A refusal with a machine `code` and a human `message`. The ONE error class of `net/`. */
export class NetError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'NetError'
    this.code = code
  }
}

export interface FailureDescription {
  /** A short human sentence naming what happened. */
  title: string
  /** The server's (or this client's) own code. */
  code: string
  /** The detail, verbatim. */
  message: string
}

const CONNECTION_CODES = new Set(['socket_error', 'connect_failed', 'connection_closed'])
const ROOM_CODES = new Set(['no_such_room', 'room_full', 'already_in_room', 'not_in_room', 'too_many_rooms'])
const MOVE_CODES = new Set(['not_your_turn', 'not_seated', 'stale_move', 'not_started'])

function titleFor(code: string): string {
  if (code === 'hub_not_configured') return 'Online play is not set up in this build.'
  if (code === 'rate_limited') return 'The game server is busy — slowing down.'
  if (CONNECTION_CODES.has(code)) return 'Could not reach the game server.'
  if (ROOM_CODES.has(code)) return 'The game server refused.'
  if (MOVE_CODES.has(code)) return 'That move was not accepted.'
  if (code === 'bad_world' || code === 'bad_backup') return 'A game record could not be read.'
  if (code === 'bad_cued_pass') return 'Your cued pass could not be read.'
  return 'Online play failed.'
}

/** ONE sentence for a failure, wherever the app states one. */
export function formatFailureStatus(failure: FailureDescription): string {
  return `${failure.title} ${failure.message}`
}

export function describeFailure(error: unknown): FailureDescription {
  if (error instanceof NetError) {
    return { title: titleFor(error.code), code: error.code, message: error.message }
  }
  // The GameHub client rejects with `Error & { code }` for a server refusal.
  const code =
    typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : 'unknown'
  const message = error instanceof Error ? error.message : String(error)
  return { title: titleFor(code), code, message }
}
