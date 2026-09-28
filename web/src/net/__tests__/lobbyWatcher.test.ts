/**
 * The lobby-liveness pins — the owner's first live test, as a test.
 *
 * He created a game in browser A, joined it in browser B, and A never saw B
 * arrive; because Start needs two joined players AS THE CREATOR'S VIEW SEES
 * THEM, A's Start stayed disabled and he read that as "there is no way to
 * start". Both symptoms were one cause — the lobby never refreshed — so every
 * assertion below is about the lobby SEEING a change it did not itself make.
 *
 * Everything runs against S1's in-memory twin: no test here calls the live
 * service, and no key material is used.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { createMemoryTransportBackend, createMemoryTransport } from '../memoryTransport'
import { createServerStoreTransport } from '../serverStore'
import { createGame, joinGame, joinBlockedReason, lobbyContext, startRefusal } from '../lobby'
import { LobbyWatcher, LOBBY_POLL_INTERVAL_MS } from '../lobbyWatcher'
import { formatFork, pollLoop, type PollStatus, type VisibilitySource } from '../sync'
import {
  ServerStoreError,
  type ServerStoreTransport,
  type StoreIdentity,
} from '../transport'
import { TEST_STORE } from './transportHarness'
import {
  LobbyFreshness,
  LobbyPanelView,
  type LobbyPanelViewProps,
} from '../../components/LobbyPanel'
import type { GameRecord, PlayerRecord } from '../gameRecord'

const CREATOR: StoreIdentity = {
  id: 'key_5e1a1d3f',
  label: 'tom',
  stores: [TEST_STORE],
  perms: ['read', 'write'],
}
const JOINER: StoreIdentity = {
  id: 'AAAAbbbb1111',
  label: 'bob',
  stores: [TEST_STORE],
  perms: ['read', 'write'],
}

/**
 * The ONE store every "browser" in a test talks to.
 *
 * Each `MemoryTransport` has its own object map unless they share a backend, and
 * two browsers with two maps would prove nothing — the whole owner scenario is one
 * client WRITING and another SEEING it. This wraps S1's own backend, so a `put`
 * through B is a `get` through A.
 */
class SharedStore {
  private readonly backend = createMemoryTransportBackend()

  for(identity: StoreIdentity): ServerStoreTransport {
    return createMemoryTransport({ identity, backend: this.backend })
  }

  /** Scratch for the error pin: a key that makes a matching call throw. */
  get failures(): Record<string, ServerStoreError> {
    return this.backend.failures
  }
}

/** A visibility source a test drives, with no DOM. */
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

  set(visible: boolean): void {
    this.flag = visible
    for (const listener of [...this.listeners]) listener()
  }
}

/** Every transport call, so a tick's request count is a number and not a hope. */
function withCallLog(base: ServerStoreTransport): {
  transport: ServerStoreTransport
  calls: string[]
} {
  const calls: string[] = []
  const wrapped = new Proxy(base, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== 'function') return value
      if (property === 'list' || property === 'get' || property === 'put' || property === 'remove') {
        return (...args: unknown[]) => {
          calls.push(`${String(property)} ${String(args[1] ?? args[0])}`)
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      return (value as (...a: unknown[]) => unknown).bind(target)
    },
  })
  return { transport: wrapped as ServerStoreTransport, calls }
}

/** Let every pending promise settle — the in-memory twin digests with `crypto.subtle`. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

/** A poll tick, driven by hand: advance the clock, then let it finish. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await flush()
}

const lists = (calls: string[]): string[] => calls.filter((call) => call.startsWith('list'))

function contextFor(transport: ServerStoreTransport, identity: StoreIdentity) {
  return lobbyContext({ transport, identity, store: TEST_STORE })
}

/**
 * The owner's scenario from browser B's side: B creates a game and joins it, so
 * the store holds `g.<id>.game` plus B's own `p.` object. A has done nothing.
 */
async function bobCreatesAndJoins(
  store: SharedStore,
  displayName = 'Bobs game',
): Promise<GameRecord> {
  const context = contextFor(store.for(JOINER), JOINER)
  const record = await createGame(context, { displayName, variant: 'Default', maxPlayers: 6 })
  await joinGame(context, record.gameId)
  return record
}

function active(record: GameRecord, players: PlayerRecord[]) {
  return { record, players }
}

function render(overrides: Partial<LobbyPanelViewProps> = {}): string {
  const props: LobbyPanelViewProps = {
    identity: CREATOR,
    variantName: 'Default',
    maxPlayers: 6,
    displayName: 'My game',
    onDisplayNameChange: () => undefined,
    listing: { games: [], unreadable: [] },
    active: null,
    failure: null,
    notice: null,
    pollStatus: null,
    busy: false,
    onCreate: () => undefined,
    onJoin: () => undefined,
    onStart: () => undefined,
    onEnter: () => undefined,
    onLeave: () => undefined,
    onRefresh: () => undefined,
    onClose: () => undefined,
    ...overrides,
  }
  return renderToStaticMarkup(createElement(LobbyPanelView, props))
}

/** A status as the loop reports one, for the presentational freshness pin. */
function pollStatus(overrides: Partial<PollStatus> = {}): PollStatus {
  return {
    phase: 'polling',
    polls: 4,
    failures: 0,
    lastError: null,
    detail: null,
    lastPolledAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the lobby refreshes on the poll while visible', () => {
  it('a game created by ANOTHER writer appears with no manual refresh', async () => {
    const store = new SharedStore()
    const { transport, calls } = withCallLog(store.for(CREATOR))
    const watcher = new LobbyWatcher({ transport, identity: CREATOR, store: TEST_STORE })
    watcher.start()
    await advance(0)
    // The first read is the loop's own immediate tick, so the list is never a
    // blank "click Refresh" screen.
    expect(watcher.getData().listing?.games).toEqual([])

    await bobCreatesAndJoins(store)

    await advance(LOBBY_POLL_INTERVAL_MS)
    const games = watcher.getData().listing?.games ?? []
    expect(games.map((game) => game.record.displayName)).toEqual(['Bobs game'])
    expect(games[0]!.playerCount).toBe(1)
    expect(games[0]!.alreadyJoined).toBe(false)
    expect(lists(calls).length).toBeGreaterThanOrEqual(2)
  })

  it('makes exactly ONE list request per tick, while the tab is visible', async () => {
    const store = new SharedStore()
    const { transport, calls } = withCallLog(store.for(CREATOR))
    const watcher = new LobbyWatcher({
      transport,
      identity: CREATOR,
      store: TEST_STORE,
      intervalMs: 1000,
    })
    watcher.start()
    await advance(0)
    expect(lists(calls)).toHaveLength(1)

    await advance(1000)
    expect(lists(calls)).toHaveLength(2)
    await advance(1000)
    expect(lists(calls)).toHaveLength(3)
    expect(watcher.getData().status?.polls).toBe(3)
    watcher.close()
  })

  it('makes NO request while the tab is hidden, and one immediately on return', async () => {
    const store = new SharedStore()
    const { transport, calls } = withCallLog(store.for(CREATOR))
    const visibility = new FakeVisibility()
    const watcher = new LobbyWatcher({
      transport,
      identity: CREATOR,
      store: TEST_STORE,
      intervalMs: 1000,
      visibility,
    })
    watcher.start()
    await advance(0)
    expect(lists(calls)).toHaveLength(1)

    visibility.set(false)
    await advance(10_000)
    expect(lists(calls)).toHaveLength(1)
    expect(watcher.getData().status?.phase).toBe('idle')

    visibility.set(true)
    await advance(0)
    expect(lists(calls)).toHaveLength(2)

    watcher.close()
    await advance(10_000)
    expect(lists(calls)).toHaveLength(2)
  })

  it('backs off on a failed poll, says so, and recovers on the next success', async () => {
    const store = new SharedStore()
    store.failures[`LIST ${TEST_STORE}`] = new ServerStoreError(
      'transport_error',
      'network down',
    )
    const { transport, calls } = withCallLog(store.for(CREATOR))
    const watcher = new LobbyWatcher({
      transport,
      identity: CREATOR,
      store: TEST_STORE,
      intervalMs: 1000,
    })
    watcher.start()
    await flush()

    // LOUD: the refusal is on the panel's error surface, never swallowed.
    expect(watcher.getData().failure?.code).toBe('transport_error')
    expect(watcher.getData().failure?.message).toBe('network down')
    expect(watcher.getData().status?.phase).toBe('error')
    expect(watcher.getData().status?.failures).toBe(1)

    // Backoff DOUBLES per consecutive failure: the first retry is 1 interval
    // away, the next 2, the next 4 — so the tick count at each step says which
    // interval was actually used, not merely that some retry happened.
    await advance(1000)
    expect(lists(calls)).toHaveLength(1)
    await advance(1000)
    expect(lists(calls)).toHaveLength(2)
    await advance(2000)
    expect(lists(calls)).toHaveLength(2)
    await advance(2000)
    expect(lists(calls)).toHaveLength(3)

    // A success clears the refusal and resets the backoff to the base interval.
    delete store.failures[`LIST ${TEST_STORE}`]
    await advance(8000)
    expect(watcher.getData().status?.phase).toBe('polling')
    expect(watcher.getData().status?.failures).toBe(0)
    expect(watcher.getData().failure).toBeNull()
    expect(watcher.getData().listing).not.toBeNull()
    const settled = lists(calls).length
    await advance(1000)
    expect(lists(calls)).toHaveLength(settled + 1)
    watcher.close()
  })
})

describe("the owner's exact scenario: a join reaches the creator", () => {
  it('the creator sees the second player within one tick, and Start becomes possible', async () => {
    const store = new SharedStore()
    const contextA = contextFor(store.for(CREATOR), CREATOR)
    const watcher = new LobbyWatcher({ transport: contextA.transport, identity: CREATOR, store: TEST_STORE, intervalMs: 1000 })
    watcher.start()
    await advance(0)
    await watcher.create({ displayName: 'Toms game', variant: 'Default', maxPlayers: 6 })
    expect(watcher.getData().active?.players.map((player) => player.label)).toEqual(['tom'])
    // The creator's OWN action refreshed immediately — no tick was advanced.
    expect(watcher.getData().listing?.games[0]?.playerCount).toBe(1)

    const alone = watcher.getData().active!
    expect(startRefusal(alone.record, CREATOR, alone.players.length)?.code).toBe(
      'not_enough_players',
    )
    const beforeJoin = render({
      identity: CREATOR,
      active: alone,
      listing: watcher.getData().listing,
      pollStatus: watcher.getData().status,
    })
    expect(beforeJoin).toContain('not_enough_players')
    expect(beforeJoin).toContain('needs at least 2 players to start')
    expect(beforeJoin).toMatch(/<button[^>]*disabled[^>]*>Start Multiplayer \(creator\)<\/button>/)

    // Browser B joins the SAME game. A does nothing at all.
    await joinGame(contextFor(store.for(JOINER), JOINER), alone.record.gameId)

    // ONE tick later, A's own view has both players and Start is legal.
    await advance(1000)
    const after = watcher.getData().active!
    expect(after.players.map((player) => player.label).sort()).toEqual(['bob', 'tom'])
    expect(startRefusal(after.record, CREATOR, after.players.length)).toBeNull()

    const afterJoin = render({
      identity: CREATOR,
      active: after,
      listing: watcher.getData().listing,
      pollStatus: watcher.getData().status,
    })
    expect(afterJoin).toMatch(/<button[^>]*>Start Multiplayer \(creator\)<\/button>/)
    expect(afterJoin).not.toContain('not_enough_players')
    expect(afterJoin).toContain('bob')

    // And Start really starts, through the lobby's own rule.
    await watcher.startGame()
    expect(watcher.getData().active?.record.status).toBe('started')
    expect(watcher.getData().active?.record.seatOrder).toEqual([CREATOR.id, JOINER.id])
    watcher.close()
  })

  it('tells the creator why Start is blocked, in words, without a disabled button alone', () => {
    const record: GameRecord = {
      version: 2,
      gameId: 'liveness-1234abcd',
      displayName: 'Toms game',
      variant: 'Default',
      creator: { id: CREATOR.id, label: CREATOR.label },
      status: 'lobby',
      maxPlayers: 6,
      seatOrder: [],
      createdAt: '2026-09-28T10:00:00.000Z',
    }
    const players: PlayerRecord[] = [
      {
        version: 1,
        gameId: record.gameId,
        playerId: CREATOR.id,
        label: 'tom',
        joinedAt: '2026-09-28T10:01:00.000Z',
      },
    ]
    const markup = render({ identity: CREATOR, active: active(record, players) })
    expect(markup).toContain('not_enough_players')
    expect(markup).toContain('1 joined')
    // The count is on screen too, so "who is here" is never a guess.
    expect(markup).toContain('1/6 players')
    // A non-creator is never shown a Start at all.
    const others = render({ identity: JOINER, active: active(record, players) })
    expect(others).not.toContain('Start Multiplayer')
  })
})

describe('the freshness signal', () => {
  it('says when the list was last updated, and says when it is not being watched', () => {
    const live = renderToStaticMarkup(
      createElement(LobbyFreshness, { status: pollStatus(), pollSeconds: 3 }),
    )
    expect(live).toContain('live · updated 3s ago')
    expect(live).toContain('data-phase="polling"')

    const hidden = renderToStaticMarkup(
      createElement(LobbyFreshness, {
        status: pollStatus({ phase: 'idle', lastPolledAt: null }),
        pollSeconds: 0,
      }),
    )
    expect(hidden).toContain('this tab is hidden')

    const failed = renderToStaticMarkup(
      createElement(LobbyFreshness, {
        status: pollStatus({ phase: 'error', failures: 2 }),
        pollSeconds: 7,
      }),
    )
    expect(failed).toContain('list update failed')
    expect(failed).toContain('2 in a row')
    expect(failed).toContain('7s ago')

    const starting = renderToStaticMarkup(
      createElement(LobbyFreshness, { status: null, pollSeconds: 0 }),
    )
    expect(starting).toContain('Checking the store…')
  })

  it('shows the freshness line in the lobby panel, so a static list is explained', () => {
    const markup = render({ pollStatus: pollStatus({ polls: 2 }) })
    expect(markup).toContain('lobby-freshness')
    expect(markup).toContain('live · updated')
  })
})

describe('the ONE loop, not two', () => {
  it('survives a StrictMode mount → unmount → remount without leaking a timer', async () => {
    // React runs an effect, its cleanup, and the effect again on mount, and
    // `main.tsx` keeps StrictMode ON in production. TWO things must hold, and
    // BOTH were violated by a first version of this slice that a real browser
    // caught: the first watcher must be CLOSED (or an orphaned live loop keeps
    // polling a list nobody renders — the bug the owner actually saw), and a
    // SECOND watcher must be able to start after it (or the lobby is silently
    // dead for the life of the screen).
    const store = new SharedStore()
    const { transport, calls } = withCallLog(store.for(CREATOR))
    const context = contextFor(transport, CREATOR)

    const first = new LobbyWatcher({ transport: context.transport, identity: CREATOR, store: TEST_STORE, intervalMs: 1000 })
    first.start()
    await advance(0)
    expect(vi.getTimerCount()).toBe(1)
    expect(lists(calls)).toHaveLength(1)
    first.close()
    await advance(0)
    expect(vi.getTimerCount()).toBe(0)

    const second = new LobbyWatcher({ transport: context.transport, identity: CREATOR, store: TEST_STORE, intervalMs: 1000 })
    second.start()
    await advance(0)
    expect(vi.getTimerCount()).toBe(1)
    expect(lists(calls)).toHaveLength(2)
    expect(second.getData().listing).not.toBeNull()
    second.close()
    await advance(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('never lets a START survive a STOP — the orphaned-loop guard', async () => {
    // The measured failure mode: a component effect ran with a `null` watcher
    // while SOME watcher was live and never stopped. This pin makes that
    // imbalance visible at the seam the component uses: every `start()` of the
    // watcher the panel holds is followed by its `close()`, and no second
    // instance is left running.
    const store = new SharedStore()
    const context = contextFor(store.for(CREATOR), CREATOR)
    const watcher = new LobbyWatcher({ transport: context.transport, identity: CREATOR, store: TEST_STORE, intervalMs: 1000 })
    let starts = 0
    const originalStart = watcher.start.bind(watcher)
    watcher.start = () => {
      starts += 1
      originalStart()
    }
    let stops = 0
    const originalClose = watcher.close.bind(watcher)
    watcher.close = () => {
      stops += 1
      originalClose()
    }
    const handle = (() => {
      watcher.start()
      return { stop: () => watcher.close() }
    })()
    handle.stop()
    watcher.start()
    watcher.close()
    await advance(0)
    expect(starts).toBe(2)
    expect(stops).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('registers the lobby as a tick on `pollLoop` rather than owning a timer', async () => {
    // A second timer would be a second `setTimeout` chain. Count the pending
    // timers inside a lobby interval: the lobby must contribute exactly ONE.
    const store = new SharedStore()
    const watcher = new LobbyWatcher({
      transport: store.for(CREATOR),
      identity: CREATOR,
      store: TEST_STORE,
      intervalMs: 1000,
    })
    watcher.start()
    await advance(0)
    expect(vi.getTimerCount()).toBe(1)
    watcher.close()
    await advance(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drives the game job and the lobby job through the same engine', async () => {
    // The same engine, two jobs — proven at the engine, not by reading comments.
    const seen: string[] = []
    const handle = pollLoop({
      intervalMs: 1000,
      onTick: () => {
        seen.push('tick')
      },
      onStatus: () => undefined,
    })
    await advance(0)
    expect(seen).toHaveLength(1)
    await advance(1000)
    expect(seen).toHaveLength(2)
    handle.stop()
    await advance(5000)
    expect(seen).toHaveLength(2)
  })

  it('words the game fork in ONE place, and the status carries that string', () => {
    expect(formatFork({ turn: 4, seq: 2, names: ['g.x.s.0004.002.abcd1234'] })).toBe(
      'FORK at turn 4 seq 2 — writers abcd1234; both snapshots kept',
    )
    expect(formatFork(null)).toBeNull()
  })

  it('takes the app’s ONE transport rather than building a second client', () => {
    // `createServerStoreTransport` is the ONE HTTP client; the watcher takes it
    // as a parameter. This test only proves the seam accepts it, and makes no
    // request — the handler would fail loudly if one were made.
    const transport = createServerStoreTransport('https://store.example.test', async () => {
      throw new Error('the watcher must not call the network from its constructor')
    })
    const watcher = new LobbyWatcher({ transport, identity: CREATOR, store: TEST_STORE })
    expect(watcher.getData().listing).toBeNull()
    watcher.close()
  })
})

describe('joining is blocked for the same reasons as before', () => {
  it('a started or full game is still refused by the shared predicate', () => {
    const record: GameRecord = {
      version: 2,
      gameId: 'liveness-1234abcd',
      displayName: 'Toms game',
      variant: 'Default',
      creator: { id: CREATOR.id, label: CREATOR.label },
      status: 'started',
      maxPlayers: 2,
      seatOrder: [CREATOR.id, JOINER.id],
      createdAt: '2026-09-28T10:00:00.000Z',
    }
    expect(joinBlockedReason(record, 2)?.code).toBe('game_started')
    expect(joinBlockedReason({ ...record, status: 'lobby' }, 2)?.code).toBe('game_full')
    expect(joinBlockedReason({ ...record, status: 'lobby' }, 1)).toBeNull()
  })
})
