/**
 * Turning a connection failure into something a person can read — WITHOUT
 * hiding the service's own words.
 *
 * The store's error envelope carries a `code` and a `message`; both survive
 * into the UI (`AGENTS.md` rule 1: a failure is never silent, and errors are
 * visible through the app's one error surface).
 */

import { RATE_LIMITED_CODE, ServerStoreError } from './transport'

export interface FailureDescription {
  /** A short human sentence naming what happened. */
  title: string
  /** The service's own code, kept for a caller that wants to branch on it. */
  code: string
  /** The service's own message, verbatim. */
  message: string
  /**
   * The service's `Retry-After`, in whole seconds, when the failure carried one
   * (a `429 rate_limited`). Present only when the service actually said so: a
   * wait this client invented would be a lie about the store's instruction.
   */
  retryAfterSeconds?: number
}

/**
 * Codes that mean "the key was refused", not "the lobby said no". The title is
 * the one thing a caller does NOT get from the service, so it has to be true:
 * a `game_full` rendered as "The store refused the key." would send the player
 * hunting for a key problem that does not exist.
 */
const KEY_CODES = new Set(['unauthorized', 'forbidden', 'no_key'])
const TRANSPORT_CODES = new Set(['transport_error', 'bad_response'])
const RECORD_CODES = new Set([
  'bad_game_record',
  'bad_player_record',
  'unsupported_record_version',
  'invalid_game_id',
  'invalid_name',
  'invalid_store',
])

function titleFor(code: string): string {
  if (code === RATE_LIMITED_CODE) return 'The store is busy — slowing down.'
  if (KEY_CODES.has(code)) return 'The store refused the key.'
  if (TRANSPORT_CODES.has(code)) return 'Could not reach the store.'
  if (RECORD_CODES.has(code)) return 'A game record could not be read.'
  if (code === 'not_found') return 'The store does not have that object.'
  return 'The lobby refused.'
}

/**
 * ONE sentence for a failure, wherever the app states one — the poll loop's
 * status line, the lobby's alert and the game's status line all render THIS, so
 * "the store is busy" can never be worded one way in the lobby and another in a
 * game. A rate limit reads as PACING rather than a catastrophe: the service told
 * us to slow down and we are doing exactly that.
 */
export function formatFailureStatus(failure: FailureDescription): string {
  const limit =
    failure.code === RATE_LIMITED_CODE && failure.retryAfterSeconds !== undefined
      ? ` — retrying in ${failure.retryAfterSeconds}s`
      : ''
  return `${failure.title}${limit} ${failure.message}`
}

export function describeFailure(error: unknown): FailureDescription {
  if (error instanceof ServerStoreError) {
    return {
      title: titleFor(error.code),
      code: error.code,
      message: error.message,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.retryAfterSeconds }),
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { title: 'Could not reach the store.', code: 'unknown', message }
}
