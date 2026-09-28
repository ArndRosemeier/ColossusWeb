/**
 * S9 part B — the pins for the ONE request retrier that a DELETE loop uses.
 *
 * The rule (and where it lives): `requestRetry.ts` owns the arithmetic —
 * `nextRetryDelayMs`, moved out of `sync.ts` so the poll loop's TIMER and a
 * single request's retry cannot disagree about how long to leave the store alone.
 * These pins are about the RETRIER half: obey `Retry-After`, give up after a
 * bounded number of attempts, propagate anything that is not the store's refusal,
 * and never swallow the last failure.
 *
 * `sleep` is injected, so the test pins what was SCHEDULED without waiting for it
 * (the same method `pollRateLimit.test.ts` uses for the loop).
 */
import { describe, expect, it } from 'vitest'
import {
  createRequestRetrier,
  nextRetryDelayMs,
  RATE_LIMIT_DELAY_FLOOR_MS,
} from '../requestRetry'
import { RATE_LIMITED_CODE, ServerStoreError } from '../transport'

function rateLimited(retryAfterSeconds?: number): ServerStoreError {
  return new ServerStoreError(RATE_LIMITED_CODE, 'slow down', 429, retryAfterSeconds)
}

/** A fake `sleep` that records the waits instead of performing them. */
function recorder(): { waits: number[]; sleep: (ms: number) => Promise<void> } {
  const waits: number[] = []
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms)
    },
  }
}

describe('S9-B · the ONE request retrier (the delete loop’s limiter harness)', () => {
  it('obeys the store’s Retry-After instead of guessing', async () => {
    const clock = recorder()
    const retrier = createRequestRetrier({ sleep: clock.sleep })
    let attempts = 0
    const value = await retrier(async () => {
      attempts += 1
      if (attempts === 1) throw rateLimited(5)
      return 'ok'
    })
    expect(value).toBe('ok')
    expect(attempts).toBe(2)
    expect(clock.waits).toEqual([5000])
  })

  it('a 429 with NO readable Retry-After keeps the doubling backoff, floored', async () => {
    const clock = recorder()
    const retrier = createRequestRetrier({ sleep: clock.sleep })
    let attempts = 0
    await retrier(async () => {
      attempts += 1
      if (attempts < 3) throw rateLimited()
      return 'ok'
    })
    expect(clock.waits).toEqual([
      RATE_LIMIT_DELAY_FLOOR_MS * 2,
      RATE_LIMIT_DELAY_FLOOR_MS * 4,
    ])
  })

  it('gives up after maxAttempts and hands the store’s OWN refusal to the caller', async () => {
    const clock = recorder()
    const retrier = createRequestRetrier({ maxAttempts: 3, sleep: clock.sleep })
    let attempts = 0
    const failure = await retrier(async () => {
      attempts += 1
      throw rateLimited(2)
    }).catch((error: unknown) => error)
    expect(attempts).toBe(3)
    expect(failure).toBeInstanceOf(ServerStoreError)
    expect((failure as ServerStoreError).code).toBe(RATE_LIMITED_CODE)
    expect((failure as ServerStoreError).retryAfterSeconds).toBe(2)
    expect(clock.waits).toEqual([2000, 2000])
  })

  it('a LOCAL refusal is never retried — this retries the store, not our own bugs', async () => {
    const clock = recorder()
    const retrier = createRequestRetrier({ sleep: clock.sleep })
    let attempts = 0
    const failure = await retrier(async () => {
      attempts += 1
      throw new ServerStoreError('invalid_name', 'illegal object name')
    }).catch((error: unknown) => error)
    expect(attempts).toBe(1)
    expect(clock.waits).toEqual([])
    expect((failure as ServerStoreError).code).toBe('invalid_name')
  })

  it('a non-store error propagates immediately, unchanged', async () => {
    const clock = recorder()
    const retrier = createRequestRetrier({ sleep: clock.sleep })
    const boom = new Error('our own bug')
    await expect(retrier(async () => Promise.reject(boom))).rejects.toBe(boom)
    expect(clock.waits).toEqual([])
  })

  it('nextRetryDelayMs is the ONE rule: Retry-After wins, bounded 1s..15min', () => {
    expect(nextRetryDelayMs(rateLimited(30), 1000, 0)).toBe(30000)
    // Below the floor: obeying a shorter wait than we would have used is not obeying.
    expect(nextRetryDelayMs(rateLimited(0), 1000, 0)).toBe(RATE_LIMIT_DELAY_FLOOR_MS)
    // A hostile header cannot park a caller for ever.
    expect(nextRetryDelayMs(rateLimited(99999), 1000, 0)).toBe(15 * 60 * 1000)
    // Anything else: the doubling backoff, capped at 8x, unchanged — and it is
    // the FAILURE COUNT that scales it, exactly as the poll loop does it.
    expect(nextRetryDelayMs(new ServerStoreError('conflict', 'x'), 1000, 0)).toBe(1000)
    expect(nextRetryDelayMs(new ServerStoreError('conflict', 'x'), 1000, 1)).toBe(2000)
    expect(nextRetryDelayMs(new ServerStoreError('conflict', 'x'), 1000, 3)).toBe(8000)
    expect(nextRetryDelayMs(new ServerStoreError('conflict', 'x'), 1000, 9)).toBe(8000)
  })
})
