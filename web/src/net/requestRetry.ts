/**
 * ONE request, retried when the store's rate limiter refuses it — and the ONE
 * place the "how long after a `429`" arithmetic lives.
 *
 * ## Why this is not the poll loop
 *
 * `sync.ts`'s loop owns a TIMER, and its backoff lives in that timer, so a single
 * request could never reuse it. A delete of a long game is ~100 sequential
 * DELETEs (`lobby.deleteGames`), and a refusal in the middle would otherwise be a
 * dead end with half the game gone. So the arithmetic moved HERE, where both
 * callers read it:
 *
 *  - `pollLoop` keeps retrying FOR EVER at the store's own pace (that is what a
 *    watcher does) and uses `retryDelayMs` through `nextPollDelayMs`;
 *  - an ACTION gives up after {@link RetryOptions.maxAttempts} attempts and hands
 *    the refusal to its caller, which reports exactly what was and was not done.
 *
 * The bounds are the same in both, and are deliberately far from any real value:
 * a malformed or hostile `Retry-After` must not park a caller for ever (a stall
 * no user could distinguish from a hang) or spin it inside the window it was told
 * to leave. The FLOOR is the poll's own base interval — obeying a *smaller* wait
 * than we would have used anyway is not obeying anything.
 */

import { RATE_LIMITED_CODE, ServerStoreError } from './transport'

export const RATE_LIMIT_DELAY_FLOOR_MS = 1000
export const RATE_LIMIT_DELAY_CEILING_MS = 15 * 60 * 1000

/** A `Retry-After` in whole seconds, as a bounded delay in milliseconds. */
export function retryDelayMs(seconds: number): number {
  return Math.min(Math.max(seconds * 1000, RATE_LIMIT_DELAY_FLOOR_MS), RATE_LIMIT_DELAY_CEILING_MS)
}

/**
 * When the next attempt runs after a FAILED one — the ONE rule about retry
 * timing, exported so its arithmetic can be pinned directly (the loop that USES
 * it is pinned separately; a test that had to infer the delay from tick counts
 * would be testing the fake clock instead).
 *
 *  - **A rate limit OBEYS `Retry-After`.** The service told us how long to leave
 *    it alone, so the delay is that (bounded), NOT the doubling backoff — whose
 *    cap is `interval × 8` (16s in a game, 40s in the lobby) and would therefore
 *    retry INSIDE the 60-second window it was told to wait out, making the
 *    refusal worse. A `429` with no readable header falls back to the backoff,
 *    which is the old behaviour rather than an invented wait.
 *  - **Anything else keeps the existing doubling backoff**, unchanged.
 */
export function nextRetryDelayMs(error: unknown, intervalMs: number, failures: number): number {
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
 * May this failure be retried? **Only a store refusing a request that could
 * succeed on a second try**, never a refusal this client minted itself, and never
 * a PERMISSION answer.
 *
 * The distinction is not cosmetic: `ServerStoreError` carries all of them.
 *
 *  - A `429`, a `5xx`/`conflict`, a `not_found` that lost a race or a
 *    `transport_error` from a dropped connection are answers that may differ next
 *    time.
 *  - A `403 forbidden` / `401 unauthorized` will NOT differ for the same key:
 *    `delete` is OPT-IN in ServerStore and the owner's live keys are `read,write`,
 *    so retrying simply spends the rate-limit budget we are trying to respect and
 *    delays the refusal the user has to ACT on. (Measured: before this, the owner's
 *    own 403 took five attempts and ~5s of backoff to report.)
 *  - An `invalid_name` / `invalid_store` / `bad_game_record` is OUR boundary guard
 *    (`transport.ts`, `gameRecord.ts`) and fails identically for ever, delaying a
 *    bug's only visible symptom.
 */
const LOCAL_REFUSAL_CODES = new Set([
  'invalid_name',
  'invalid_store',
  'invalid_game_id',
  'invalid_player_id',
  'bad_game_record',
  'bad_player_record',
  'bad_snapshot',
  'unsupported_record_version',
  'unsupported_snapshot_version',
  'unsupported_save_version',
  'snapshot_budget_exceeded',
  'invalid_body',
  'invalid_max_players',
  'no_display_name',
  'no_variant',
  // A permission answer is final for this key — see the note above.
  'forbidden',
  'unauthorized',
  'no_key',
])

export function isRetriable(error: unknown): boolean {
  if (!(error instanceof ServerStoreError)) return false
  if (LOCAL_REFUSAL_CODES.has(error.code)) return false
  if (error.code === RATE_LIMITED_CODE) return true
  // A `transport_error` never reached the store, so nothing was decided there.
  if (error.code === 'transport_error') return true
  // Any other answer the SERVICE gave (4xx/5xx) may differ on a second attempt.
  return error.status !== null
}

export interface RetryOptions {
  /** Total attempts, including the first. Default 5. */
  readonly maxAttempts?: number
  /**
   * The base for the non-rate-limit backoff. Defaults to the retry floor (1s), so
   * a `429` without a readable `Retry-After` waits 2s, 4s, 8s, 16s — the poll
   * loop's shape at the smallest interval the limiter rule allows.
   */
  readonly intervalMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  /** Every wait this retrier schedules, for a caller that wants to say so. */
  readonly onWait?: (ms: number, error: unknown, attempt: number) => void
}

export type RequestRetrier = <T>(run: () => Promise<T>) => Promise<T>

/**
 * Build a retrier: run `run`, and if the STORE REFUSES with a
 * {@link ServerStoreError} (a `429`, and also a `5xx`/`conflict`) wait
 * {@link nextRetryDelayMs} and try again, up to `maxAttempts`.
 *
 * A non-retriable failure — anything that is not a {@link ServerStoreError}, and
 * the LOCAL refusals our own guards mint (see {@link isRetriable}) — is
 * propagated immediately: this retries the STORE, it does not paper over our own
 * bugs. So is the LAST attempt's failure: the caller must see the store's own
 * code and message, never a silent give-up.
 */
export function createRequestRetrier(options: RetryOptions = {}): RequestRetrier {
  const maxAttempts = options.maxAttempts ?? 5
  const interval = options.intervalMs ?? RATE_LIMIT_DELAY_FLOOR_MS
  const sleep =
    options.sleep ??
    ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)))
  return async <T>(run: () => Promise<T>): Promise<T> => {
    let failures = 0
    for (;;) {
      try {
        return await run()
      } catch (error) {
        failures += 1
        if (!isRetriable(error) || failures >= maxAttempts) throw error
        const wait = nextRetryDelayMs(error, interval, failures)
        options.onWait?.(wait, error, failures)
        await sleep(wait)      }
    }
  }
}
