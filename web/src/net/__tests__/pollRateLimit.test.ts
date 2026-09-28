/**
 * The rate-limit pins (S5, part B) — the store's limiter, as the client obeys it.
 *
 * The service answers `429 rate_limited` with `Retry-After: <whole seconds>`, and
 * the statement under test is about TIME, not about an exception: after a
 * refusal, the next poll must be scheduled NO SOONER than that many seconds —
 * the doubling backoff (capped at `interval × 8`, i.e. 16s in a game and 40s in
 * the lobby) would retry INSIDE the 60-second window it was told to leave alone.
 *
 * Everything runs against scripted fakes: no test here calls the live service,
 * and no key material is used beyond the harness's own test-only key.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeFailure, formatFailureStatus } from '../failure'
import { createMemoryTransport } from '../memoryTransport'
import { createServerStoreTransport } from '../serverStore'
import { LOBBY_POLL_INTERVAL_MS } from '../lobbyWatcher'
import {
  GAME_POLL_INTERVAL_MS,
  nextPollDelayMs,
  pollLoop,
  type PollStatus,
  type VisibilitySource,
} from '../sync'
import { RATE_LIMITED_CODE, ServerStoreError, type ServerStoreTransport } from '../transport'
import { TEST_KEY, TEST_STORE, FakeStoreFetch } from './transportHarness'
import { forgetKey, installKey } from '../keyStore'

const CREATOR = { id: 'key_5e1a1d3f', label: 'tom', stores: [TEST_STORE], perms: ['read', 'write'] }

/** A visibility source a test drives, with no DOM (the same shape `sync.test.ts` uses). */
/** Let the tick's promise chain settle — a fake `fetch` still resolves async. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

class FakeVisibility implements VisibilitySource {
  private flag = true
  private readonly listeners = new Set<() => void>()

  visible(): boolean {
    return this.flag
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

const LISTS = 'GET /stores/colossus/objects'

/** A `429` exactly as the service words it: envelope, status and header. */
function rateLimited(retryAfter = 60): {
  match: string
  status: number
  code: string
  message: string
  headers: Record<string, string>
} {
  return {
    match: LISTS,
    status: 429,
    code: RATE_LIMITED_CODE,
    message: `rate limit exceeded for this client; retry in ${retryAfter}s`,
    headers: { 'retry-after': String(retryAfter) },
  }
}

beforeEach(() => {
  installKey(TEST_KEY)
})

afterEach(() => {
  forgetKey()
  vi.useRealTimers()
})

describe('the 429 reaches the caller with its Retry-After', () => {
  it('carries the code, the service message and the whole-seconds wait', async () => {
    const fake = new FakeStoreFetch()
    const transport = createServerStoreTransport('https://store.example.test', fake.fetch.bind(fake))
    fake.scriptedFailures.push(rateLimited(60))

    let caught: unknown
    try {
      await transport.list(TEST_STORE, 'game.')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ServerStoreError)
    const failure = caught as ServerStoreError
    expect(failure.code).toBe(RATE_LIMITED_CODE)
    expect(failure.status).toBe(429)
    expect(failure.retryAfterSeconds).toBe(60)
    // The request was refused BEFORE any effect — the listing is empty, and the
    // next call (now allowed) succeeds rather than returning cached fiction.
    expect((await transport.list(TEST_STORE, 'game.')).map((object) => object.name)).toEqual([])
  })

  it('refuses to invent a wait from a header it cannot read', async () => {
    for (const header of ['', 'later', '-5', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT']) {
      const fake = new FakeStoreFetch()
      const transport = createServerStoreTransport('https://store.example.test', fake.fetch.bind(fake))
      fake.scriptedFailures.push({
        match: LISTS,
        status: 429,
        code: RATE_LIMITED_CODE,
        message: 'rate limit exceeded',
        headers: { 'retry-after': header },
      })
      await expect(transport.list(TEST_STORE)).rejects.toMatchObject({
        code: RATE_LIMITED_CODE,
        retryAfterSeconds: undefined,
      })
    }
  })

  it('describes a rate limit as PACING, in one sentence, with the wait', () => {
    const failure = describeFailure(
      new ServerStoreError(RATE_LIMITED_CODE, 'rate limit exceeded; retry in 60s', 429, 60),
    )
    expect(failure.title).toBe('The store is busy — slowing down.')
    expect(failure.retryAfterSeconds).toBe(60)
    const sentence = formatFailureStatus(failure)
    expect(sentence).toContain('The store is busy — slowing down.')
    expect(sentence).toContain('retrying in 60s')
    expect(sentence).toContain('rate limit exceeded; retry in 60s')

    // A non-rate-limit failure says nothing about waiting, because it has no
    // wait to talk about.
    const other = describeFailure(new ServerStoreError('transport_error', 'network down'))
    expect(other.retryAfterSeconds).toBeUndefined()
    expect(formatFailureStatus(other)).toBe('Could not reach the store. network down')
  })
})

describe('the retry rule, as arithmetic', () => {
  const interval = GAME_POLL_INTERVAL_MS // 2000ms

  it('a 429 obeys Retry-After instead of the doubling backoff', () => {
    const limited = new ServerStoreError(RATE_LIMITED_CODE, 'slow down', 429, 60)
    // The backoff's cap at this interval is 16s — INSIDE the 60-second window
    // the store asked us to leave alone. The rule must not use it.
    expect(nextPollDelayMs(limited, interval, 1)).toBe(60_000)
    expect(nextPollDelayMs(limited, interval, 4)).toBe(60_000)
    // A tiny wait is raised to the floor, so "obeying" never means retrying
    // faster than the loop would have anyway.
    expect(nextPollDelayMs(new ServerStoreError(RATE_LIMITED_CODE, 'slow down', 429, 0), interval, 1)).toBe(
      1_000,
    )
    // ...and an absurd one cannot park the loop for ever.
    expect(
      nextPollDelayMs(new ServerStoreError(RATE_LIMITED_CODE, 'slow down', 429, 86_400), interval, 1),
    ).toBe(15 * 60 * 1000)
  })

  it('anything else keeps the doubling backoff, exactly as before S5', () => {
    const ordinary = new ServerStoreError('transport_error', 'network down')
    // 2s, 4s, 8s, 16s, then the interval x 8 ceiling at 16s.
    expect([1, 2, 3, 4, 5, 6].map((failures) => nextPollDelayMs(ordinary, interval, failures))).toEqual(
      [4_000, 8_000, 16_000, 16_000, 16_000, 16_000],
    )
    // The LOBBY's interval caps at 40s — a different number, same rule.
    expect(nextPollDelayMs(ordinary, LOBBY_POLL_INTERVAL_MS, 1)).toBe(10_000)
    expect(nextPollDelayMs(ordinary, LOBBY_POLL_INTERVAL_MS, 9)).toBe(40_000)
    // A 429 WITHOUT a readable wait is an ordinary failure: the backoff applies,
    // rather than a wait this client invented.
    expect(nextPollDelayMs(new ServerStoreError(RATE_LIMITED_CODE, 'slow down', 429), interval, 1)).toBe(
      4_000,
    )
  })
})

describe('the poll obeys the limiter', () => {
  /**
   * Advance the fake clock by `ms`, collecting every attempt that happens on the
   * way. The DELAYS between attempts are then read off the clock rather than
   * inferred from how many times a test happened to advance it.
   */
  async function advanceBy(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms)
    await flush()
  }
  it('schedules the next tick no sooner than Retry-After — 60s, not the 16s backoff cap', async () => {
    vi.useFakeTimers()
    const fake = new FakeStoreFetch()
    const transport = createServerStoreTransport('https://store.example.test', fake.fetch.bind(fake))
    fake.scriptedFailures.push(rateLimited(60))

    const statuses: PollStatus[] = []
    const handle = pollLoop({
      onTick: () => transport.list(TEST_STORE, 'game.'),
      intervalMs: GAME_POLL_INTERVAL_MS,
      visibility: new FakeVisibility(),
      onStatus: (status) => statuses.push(status),
    })
    await vi.advanceTimersByTimeAsync(0)
    await flush()
    expect(fake.calls).toHaveLength(1)
    const failed = statuses.filter((status) => status.phase === 'error')
    expect(failed.at(-1)?.lastError?.retryAfterSeconds).toBe(60)
    // The status says it in words, not as a catastrophe.
    expect(failed.at(-1)?.detail).toContain('The store is busy — slowing down.')
    expect(failed.at(-1)?.detail).toContain('retrying in 60s')

    // Every delay the doubling backoff would have used in this window: 2, 4, 8,
    // 16, 16, … seconds. NOT ONE of them may produce a request, because the store
    // asked for 60. (2+4+8+16+16 = 46s, and a further 13s is still inside.)
    for (const ms of [2_000, 4_000, 8_000, 16_000, 16_000, 13_000]) {
      await vi.advanceTimersByTimeAsync(ms)
      await flush()
      expect(fake.calls, `a request ${ms}ms into the window`).toHaveLength(1)
    }
    // At 60s the retry is allowed, and it succeeds now the refusal is spent.
    await vi.advanceTimersByTimeAsync(1_000)
    await flush()
    expect(fake.calls).toHaveLength(2)
    handle.stop()
  })

  it('keeps the existing doubling backoff for a failure that is not a rate limit', async () => {
    // The DIFFERENTIAL: the SAME 45 one-second ticks of the fake clock, once
    // against a 429 that asks for 60s and once against an ordinary failure. The
    // rate-limited loop must still be holding its tongue when the ordinary one
    // has retried several times — which is the whole S5 retry rule, seen from
    // both sides without depending on the fake clock's firing quirks.
    async function attemptsWithin45s(error: ServerStoreError, intervalMs: number): Promise<number> {
      vi.useFakeTimers()
      const arm = createMemoryTransport({ identity: CREATOR })
      let attempts = 0
      const transport: ServerStoreTransport = {
        ...arm,
        list: () => {
          attempts += 1
          return Promise.reject(error)
        },
      }
      const handle = pollLoop({
        onTick: () => transport.list(TEST_STORE, 'game.'),
        intervalMs,
        onStatus: () => undefined,
        visibility: new FakeVisibility(),
      })
      await vi.advanceTimersByTimeAsync(0)
      await flush()
      for (let i = 0; i < 45; i++) await advanceBy(1_000)
      handle.stop()
      vi.useRealTimers()
      return attempts
    }

    const limited = await attemptsWithin45s(
      new ServerStoreError(RATE_LIMITED_CODE, 'slow down', 429, 60),
      GAME_POLL_INTERVAL_MS,
    )
    const ordinary = await attemptsWithin45s(
      new ServerStoreError('transport_error', 'network down'),
      GAME_POLL_INTERVAL_MS,
    )

    // Inside the window it was told to leave alone, the rate-limited loop makes
    // NO further request at all — not the 2s/4s/8s/16s the backoff would use.
    expect(limited).toBe(1)
    // The ordinary failure retries throughout that same window (2s, 4s, 8s, 16s,
    // 16s → several attempts by 45s), exactly as it did before S5.
    expect(ordinary).toBeGreaterThanOrEqual(4)
  })
})
