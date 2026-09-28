/**
 * The body-read pins — the cache that makes a quiet tick cheap.
 *
 * The store's list route returns `{name, sha256, ...}` for every object, and
 * `sha256` is a content address. So a polling client remembers `{name -> sha256}`
 * and point-reads a body only when that name is new or its hash CHANGED. The
 * steady state of a tick — nobody did anything — is therefore **one list request
 * and zero body reads**, and a changed object costs exactly one body read.
 *
 * Four statements are pinned here, over BOTH jobs the ONE loop does:
 *  1. a tick that finds nothing changed makes exactly ONE request and reads no body;
 *  2. a tick whose content changed reads only the bodies that changed;
 *  3. a body is only ever fetched by NAME (every `get` targets a name the listing
 *     just gave us), so the list route is never used to read content;
 *  4. a name that DISAPPEARED is not served from the cache.
 *
 * All of it runs against S1's in-memory twin: no network, no key.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryTransport, createMemoryTransportBackend } from '../memoryTransport'
import { lobbyContext, joinGame } from '../lobby'
import { LobbyWatcher } from '../lobbyWatcher'
import { createContentCache } from '../contentCache'
import {
  createSyncSession,
  fetchLatest,
  gameSeedFor,
  multiplayerSeatOptions,
  pollLatest,
  publishSnapshot,
} from '../sync'
import { createGame as createEngineGame } from '../../engine/GameEngine.js'
import { loadDefaultVariant } from '../../engine/__tests__/helpers'
import {
  GAME_RECORD_VERSION,
  PLAYER_RECORD_VERSION,
  gameObjectName,
  playerObjectName,
  playerTagFor,
  serializeGameRecord,
  serializePlayerRecord,
  type GameRecord,
  type PlayerRecord,
} from '../gameRecord'
import type { ServerStoreTransport, StoreIdentity } from '../transport'
import { TEST_STORE } from './transportHarness'

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

interface Logged {
  transport: ServerStoreTransport
  calls: string[]
}

/** A transport that records every call as `"<method> <name>"`. */
function logged(base: ServerStoreTransport): Logged {
  const calls: string[] = []
  const wrapped = new Proxy(base, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        calls.push(`${String(property)} ${String(args[1] ?? args[0])}`)
        return (value as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  })
  return { transport: wrapped as ServerStoreTransport, calls }
}

const method = (call: string): string => call.split(' ')[0]!
const reads = (calls: string[]): string[] => calls.filter((call) => method(call) === 'get')
const lists = (calls: string[]): string[] => calls.filter((call) => method(call) === 'list')

/** One backend shared by every "browser" in a test — one real store. */
function store() {
  const backend = createMemoryTransportBackend()
  return {
    backend,
    for: (identity: StoreIdentity) => createMemoryTransport({ identity, backend }),
  }
}

async function seedGame(
  transport: ServerStoreTransport,
  overrides: Partial<GameRecord> = {},
): Promise<GameRecord> {
  const record: GameRecord = {
    version: GAME_RECORD_VERSION,
    gameId: 'cache-1234abcd',
    displayName: 'Cached game',
    variant: 'Default',
    creator: { id: CREATOR.id, label: CREATOR.label },
    status: 'lobby',
    maxPlayers: 6,
    seatOrder: [],
    createdAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  }
  await transport.put(TEST_STORE, gameObjectName(record.gameId), serializeGameRecord(record))
  return record
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the lobby listing reads bodies only when their hash changed', () => {
  it('a tick that finds nothing changed makes ONE request and reads NO body', async () => {
    const shared = store()
    await seedGame(shared.for(CREATOR))
    const { transport, calls } = logged(shared.for(CREATOR))
    const watcher = new LobbyWatcher({
      transport,
      identity: CREATOR,
      store: TEST_STORE,
      intervalMs: 1000,
    })
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    for (let i = 0; i < 50; i++) await Promise.resolve()

    // The FIRST tick must read the body: nothing was held yet.
    expect(lists(calls)).toHaveLength(1)
    expect(reads(calls)).toHaveLength(1)
    expect(watcher.getData().listing?.games).toHaveLength(1)

    calls.length = 0
    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 50; i++) await Promise.resolve()
    // Nothing changed: the tick is a list and NOT ONE body read.
    expect(lists(calls)).toHaveLength(1)
    expect(reads(calls)).toHaveLength(0)

    calls.length = 0
    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(lists(calls)).toHaveLength(1)
    expect(reads(calls)).toHaveLength(0)
    watcher.close()
  })

  it('reads ONLY the body that changed, and every read is by a name the listing gave', async () => {
    const shared = store()
    const first = await seedGame(shared.for(CREATOR), {
      gameId: 'cache-aaaa1111',
      displayName: 'First game',
    })
    await seedGame(shared.for(CREATOR), { gameId: 'cache-bbbb2222', displayName: 'Second game' })
    const { transport, calls } = logged(shared.for(CREATOR))
    const watcher = new LobbyWatcher({
      transport,
      identity: CREATOR,
      store: TEST_STORE,
      intervalMs: 1000,
    })
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(reads(calls)).toHaveLength(2)
    // Every read targets a name the LISTING named — never a guessed name, never
    // a content read through the list route.
    expect(reads(calls).map((call) => call.split(' ')[1])).toEqual([
      gameObjectName(first.gameId),
      gameObjectName('cache-bbbb2222'),
    ])

    // Only ONE game changes. Exactly one body is re-read.
    const changed = { ...first, maxPlayers: 4 }
    await shared.for(CREATOR).put(TEST_STORE, gameObjectName(first.gameId), serializeGameRecord(changed))
    calls.length = 0
    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(lists(calls)).toHaveLength(1)
    expect(reads(calls)).toEqual([`get ${gameObjectName(first.gameId)}`])
    const byId = new Map(watcher.getData().listing!.games.map((game) => [game.gameId, game]))
    expect(byId.get(first.gameId)!.record.maxPlayers).toBe(4)
    expect(byId.get('cache-bbbb2222')!.record.maxPlayers).toBe(6)
    watcher.close()
  })

  it('does NOT serve a disappeared name from the cache', async () => {
    const shared = store()
    const record = await seedGame(shared.for(CREATOR))
    const { transport, calls } = logged(shared.for(CREATOR))
    const watcher = new LobbyWatcher({
      transport,
      identity: CREATOR,
      store: TEST_STORE,
      intervalMs: 1000,
    })
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(watcher.getData().listing?.games).toHaveLength(1)

    await shared.for(CREATOR).remove(TEST_STORE, gameObjectName(record.gameId))
    calls.length = 0
    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(lists(calls)).toHaveLength(1)
    expect(reads(calls)).toHaveLength(0)
    // Gone means GONE: the cache never resurrects it, and no body is read.
    expect(watcher.getData().listing?.games).toHaveLength(0)
    watcher.close()
  })

  it('drops a cached body when the game it belonged to is deleted', () => {
    // The unit-level statement behind the pin above: `sync` drops absent names.
    const cache = createContentCache({
      transport: createMemoryTransport({ identity: CREATOR }),
      store: TEST_STORE,
    })
    const object = (name: string, sha256: string) => ({
      store: TEST_STORE,
      name,
      sha256,
      size: 1,
      createdAt: '2026-09-28T10:00:00.000Z',
    })
    expect(cache.sync([object('g.a.game', 'aa')])).toEqual(['g.a.game'])
    expect(cache.size()).toBe(0) // listed but not yet READ — nothing is held
    cache.put('g.a.game', 'aa', '{}')
    expect(cache.size()).toBe(1)
    expect(cache.sync([object('g.b.game', 'bb')])).toEqual(['g.b.game'])
    // A name that did not appear is dropped, so it cannot be served again.
    expect(cache.peek('g.a.game')).toBeNull()
    // The newly-listed name is not read yet, so nothing is held for it either.
    expect(cache.holds('g.b.game', 'bb')).toBe(false)
    expect(cache.size()).toBe(0)
  })
})

describe('the snapshot fetch reads a body only when its name is new or changed', () => {
  async function twoSeatRecord(shared: ReturnType<typeof store>): Promise<{
    record: GameRecord
    players: PlayerRecord[]
  }> {
    const record: GameRecord = {
      version: GAME_RECORD_VERSION,
      gameId: 'cache-sync-1234abcd',
      displayName: 'Sync cache game',
      variant: 'Default',
      creator: { id: CREATOR.id, label: CREATOR.label },
      status: 'started',
      maxPlayers: 6,
      seatOrder: [CREATOR.id, JOINER.id],
      createdAt: '2026-09-28T10:00:00.000Z',
    }
    const players: PlayerRecord[] = [CREATOR, JOINER].map((identity) => ({
      version: PLAYER_RECORD_VERSION,
      gameId: record.gameId,
      playerId: identity.id,
      label: identity.label,
      joinedAt: '2026-09-28T10:01:00.000Z',
    }))
    await shared.for(CREATOR).put(TEST_STORE, gameObjectName(record.gameId), serializeGameRecord(record))
    for (const player of players) {
      await shared
        .for(CREATOR)
        .put(
          TEST_STORE,
          playerObjectName(record.gameId, playerTagFor(player.playerId)),
          serializePlayerRecord(player),
        )
    }
    return { record, players }
  }

  it('a poll tick whose newest snapshot is unchanged reads NO body', async () => {
    const shared = store()
    const { record, players } = await twoSeatRecord(shared)
    const engine = createEngineGame(loadDefaultVariant(), {
      ...multiplayerSeatOptions(record, players),
      variantName: 'Default',
      seed: gameSeedFor(record.gameId),
    })
    // Publish ONE snapshot, so the store holds exactly one.
    await publishSnapshot(shared.for(CREATOR), CREATOR, record, engine, { store: TEST_STORE })

    const { transport, calls } = logged(shared.for(CREATOR))
    const session = createSyncSession({ transport, identity: CREATOR, record, store: TEST_STORE })
    // The adoption rule lives in the commit path (a name at or behind the held
    // one is NOT re-adopted); this mirrors it so "no read" and "no adoption"
    // are asserted together.
    let heldName: string | null = null
    const adopted: string[] = []
    const handle = pollLatest(session, {
      intervalMs: 1000,
      onAdopt: (body) => {
        if (heldName !== null && body.header.name <= heldName) return
        heldName = body.header.name
        adopted.push(body.header.name)
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 50; i++) await Promise.resolve()
    // A single snapshot is adopted ONCE even though its body may be read for the
    // fork question — the steady state is asserted below.
    expect(adopted).toHaveLength(1)
    expect(lists(calls)).toHaveLength(1)
    expect(reads(calls)[0]).toBe(`get ${adopted[0]}`)

    calls.length = 0
    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 50; i++) await Promise.resolve()
    // Unchanged: one list, NO body read, and nothing re-adopted.
    expect(lists(calls)).toHaveLength(1)
    expect(reads(calls)).toHaveLength(0)
    expect(adopted).toHaveLength(1)
    handle.stop()

    // The cache never changes WHAT is adopted: `fetchLatest` still names the
    // same snapshot, from the held bytes.
    const again = await fetchLatest(transport, record.gameId, {
      store: TEST_STORE,
      cache: session.cache,
    })
    expect(again?.body.header.name).toBe(adopted[0])
    expect(reads(calls)).toHaveLength(0)
  })
})

describe('the cache is an optimisation, not a second source of truth', () => {
  it('a name whose content changed is re-read, never served from the old hash', () => {
    const transport = createMemoryTransport({ identity: CREATOR })
    const cache = createContentCache({ transport, store: TEST_STORE })
    const object = (sha256: string) => ({
      store: TEST_STORE,
      name: 'g.a.game',
      sha256,
      size: 1,
      createdAt: '2026-09-28T10:00:00.000Z',
    })
    cache.put('g.a.game', 'old', '{"v":1}')
    expect(cache.sync([object('old')])).toEqual([])
    expect(cache.peek('g.a.game')).toBe('{"v":1}')
    // The hash moved: the entry is dropped AND the name must be re-read.
    expect(cache.sync([object('new')])).toEqual(['g.a.game'])
    expect(cache.peek('g.a.game')).toBeNull()
    expect(cache.holds('g.a.game', 'new')).toBe(false)
  })

  it('forgets one name on demand (a publish by this client says "not seen")', () => {
    const transport = createMemoryTransport({ identity: CREATOR })
    const cache = createContentCache({ transport, store: TEST_STORE })
    cache.put('g.a.game', 'aa', '{"v":1}')
    cache.forget('g.a.game')
    expect(cache.peek('g.a.game')).toBeNull()
    expect(cache.holds('g.a.game', 'aa')).toBe(false)
  })
})

describe('joining a game leaves the cache consistent', () => {
  it('a join by another client is a NEW body, not a cached one', async () => {
    const shared = store()
    const context = lobbyContext({ transport: shared.for(CREATOR), identity: CREATOR, store: TEST_STORE })
    const record = await seedGame(shared.for(CREATOR))
    const watcher = new LobbyWatcher({ transport: context.transport, identity: CREATOR, store: TEST_STORE, intervalMs: 1000 })
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(watcher.getData().listing?.games[0]?.playerCount).toBe(0)

    await joinGame(lobbyContext({ transport: shared.for(JOINER), identity: JOINER, store: TEST_STORE }), record.gameId)
    await vi.advanceTimersByTimeAsync(1000)
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(watcher.getData().listing?.games[0]?.playerCount).toBe(1)
    expect(watcher.getData().listing?.games[0]?.alreadyJoined).toBe(false)
    watcher.close()
  })
})
