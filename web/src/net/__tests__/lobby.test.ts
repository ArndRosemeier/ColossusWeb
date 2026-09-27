/**
 * The lobby-operations pins, run against BOTH transport implementations.
 *
 * Each assertion is a statement from the S2 brief, checked against the real
 * operations in `net/lobby.ts` — never against a hand-rolled store. "Writes
 * NOTHING" is asserted through a `put`/`remove` write log, not merely by catching
 * a thrown error: a refusal that wrote first would still pass a throw-only test.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  gameObjectName,
  parseGameRecord,
  playerObjectName,
  playerTagFor,
  serializeGameRecord,
} from '../gameRecord'
import { installKey, forgetKey } from '../keyStore'
import {
  MIN_PLAYERS_TO_START,
  createGame,
  joinGame,
  leaveGame,
  listGames,
  lobbyContext,
  readLobby,
  startGame,
  type LobbyContext,
} from '../lobby'
import { serverStoreName } from '../storeName'
import { ServerStoreError, type ServerStoreTransport, type StoreIdentity } from '../transport'
import {
  TEST_IDENTITY,
  TEST_KEY,
  TEST_STORE,
  httpArm,
  memoryArm,
  type Arm,
} from './transportHarness'

const ARMS: Array<[string, () => Arm]> = [
  ['HTTP implementation (stubbed fetch)', httpArm],
  ['in-memory fake', memoryArm],
]

const CREATOR: StoreIdentity = TEST_IDENTITY
const JOINER: StoreIdentity = {
  id: 'AAAAbbbb1111',
  label: 'bob',
  stores: ['colossus'],
  perms: ['read', 'write'],
}
const THIRD: StoreIdentity = {
  id: 'CCCCdddd2222',
  label: 'carol',
  stores: ['colossus'],
  perms: ['read', 'write'],
}
/** First 8 lowercased characters are `key_5e1a` — the creator's tag, different id. */
const TAG_COLLIDER: StoreIdentity = {
  id: 'key_5e1aQQQQQQ',
  label: 'impostor',
  stores: ['colossus'],
  perms: ['read', 'write'],
}

function ctx(transport: ServerStoreTransport, identity: StoreIdentity): LobbyContext {
  return lobbyContext({ transport, identity, store: TEST_STORE })
}

/** The store's own content addresses — the integrity field, used as a byte check. */
async function shaMap(transport: ServerStoreTransport): Promise<Record<string, string>> {
  const objects = await transport.list(TEST_STORE)
  return Object.fromEntries(objects.map((object) => [object.name, object.sha256]))
}

async function bodies(transport: ServerStoreTransport): Promise<string[]> {
  const objects = await transport.list(TEST_STORE)
  const values: string[] = []
  for (const object of objects) {
    values.push((await transport.get(TEST_STORE, object.name)).value)
  }
  return values
}

/** Record every `put`/`remove` the operations perform, delegating to the real one. */
function withWriteLog(base: ServerStoreTransport): {
  transport: ServerStoreTransport
  writes: string[]
} {
  const writes: string[] = []
  const wrapped = new Proxy(base, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown
      if (typeof value !== 'function') return value
      if (property === 'put' || property === 'remove') {
        return (...args: unknown[]) => {
          writes.push(`${String(property)} ${String(args[0])}/${String(args[1])}`)
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      return (value as (...a: unknown[]) => unknown).bind(target)
    },
  })
  return { transport: wrapped as ServerStoreTransport, writes }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function request(overrides: Partial<{ displayName: string; variant: string; maxPlayers: number }> = {}) {
  return { displayName: "Tom's Game!", variant: 'Default', maxPlayers: 6, ...overrides }
}

describe.each(ARMS)('%s — the lobby', (_name, makeArm) => {
  let arm: Arm

  beforeEach(() => {
    arm = makeArm()
    forgetKey()
    installKey(TEST_KEY)
  })

  it('Create writes exactly ONE object, named g.<id>.game, with a lobby body', async () => {
    const { transport, writes } = withWriteLog(arm.transport)
    const record = await createGame(ctx(transport, CREATOR), request())

    const name = gameObjectName(record.gameId)
    expect(writes).toEqual([`put ${TEST_STORE}/${name}`])
    expect(name).toMatch(/^g\.[a-z0-9._-]+\.game$/)

    const objects = await arm.transport.list(TEST_STORE)
    expect(objects.map((object) => object.name)).toEqual([name])

    const body = (await arm.transport.get(TEST_STORE, name)).value
    const parsed = parseGameRecord(body)
    expect(parsed).toEqual(record)
    expect(parsed.status).toBe('lobby')
    expect(parsed.displayName).toBe("Tom's Game!")
    expect(parsed.variant).toBe('Default')
    expect(parsed.maxPlayers).toBe(6)
    expect(parsed.creator).toEqual({ id: CREATOR.id, label: CREATOR.label })
  })

  it('Create refuses a blank name or an impossible size, and writes nothing', async () => {
    const { transport, writes } = withWriteLog(arm.transport)
    const context = ctx(transport, CREATOR)
    await expect(createGame(context, request({ displayName: '   ' }))).rejects.toMatchObject({
      code: 'no_display_name',
    })
    await expect(createGame(context, request({ variant: ' ' }))).rejects.toMatchObject({
      code: 'no_variant',
    })
    await expect(createGame(context, request({ maxPlayers: 1 }))).rejects.toMatchObject({
      code: 'invalid_max_players',
    })
    await expect(createGame(context, request({ maxPlayers: 2.5 }))).rejects.toMatchObject({
      code: 'invalid_max_players',
    })
    expect(writes).toEqual([])
    expect(await arm.transport.list(TEST_STORE)).toEqual([])
  })

  it('two games created from the same display name get different ids and never touch each other', async () => {
    const context = ctx(arm.transport, CREATOR)
    const first = await createGame(context, request({ displayName: 'Twin Game' }))
    const second = await createGame(context, request({ displayName: 'Twin Game' }))
    expect(first.gameId).not.toBe(second.gameId)

    const firstBody = (await arm.transport.get(TEST_STORE, gameObjectName(first.gameId))).value
    const secondBody = (await arm.transport.get(TEST_STORE, gameObjectName(second.gameId))).value
    expect(firstBody).toBe(serializeGameRecord(first))
    expect(secondBody).toBe(serializeGameRecord(second))
    expect(JSON.parse(firstBody).gameId).toBe(first.gameId)
    expect(JSON.parse(secondBody).gameId).toBe(second.gameId)

    const listing = await listGames(context)
    expect(listing.games.map((game) => game.gameId).sort()).toEqual(
      [first.gameId, second.gameId].sort(),
    )
  })

  it("Join writes the caller's OWN p object and modifies nothing else", async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request())
    const creatorContext = ctx(arm.transport, CREATOR)
    await joinGame(creatorContext, game.gameId)

    const before = await shaMap(arm.transport)
    const { transport, writes } = withWriteLog(arm.transport)
    const joined = await joinGame(ctx(transport, JOINER), game.gameId)

    const mine = playerObjectName(game.gameId, playerTagFor(JOINER.id))
    expect(writes).toEqual([`put ${TEST_STORE}/${mine}`])
    expect(joined.playerId).toBe(JOINER.id)
    expect(joined.label).toBe('bob')

    const after = await shaMap(arm.transport)
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), mine].sort())
    for (const [name, sha] of Object.entries(before)) {
      expect(after[name], `${name} must be byte-identical`).toBe(sha)
    }
  })

  it('joining twice is idempotent: one object, unchanged body, no second write', async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request())
    const context = ctx(arm.transport, JOINER)
    const first = await joinGame(context, game.gameId)
    const before = await shaMap(arm.transport)
    const { transport, writes } = withWriteLog(arm.transport)

    const second = await joinGame(ctx(transport, JOINER), game.gameId)
    expect(second).toEqual(first)
    expect(writes).toEqual([])
    expect(await shaMap(arm.transport)).toEqual(before)
    const playerObjects = Object.keys(before).filter((name) => name.includes('.p.'))
    expect(playerObjects).toHaveLength(1)
  })

  it('a different full id that shares the 8-character tag is refused, not overwritten', async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request())
    const context = ctx(arm.transport, CREATOR)
    await joinGame(context, game.gameId)
    const before = await shaMap(arm.transport)
    const { transport, writes } = withWriteLog(arm.transport)

    await expect(joinGame(ctx(transport, TAG_COLLIDER), game.gameId)).rejects.toMatchObject({
      code: 'player_tag_collision',
    })
    expect(writes).toEqual([])
    expect(await shaMap(arm.transport)).toEqual(before)
  })

  it('Start is refused for a non-creator and writes NOTHING', async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request())
    await joinGame(ctx(arm.transport, CREATOR), game.gameId)
    await joinGame(ctx(arm.transport, JOINER), game.gameId)
    const before = await shaMap(arm.transport)
    const { transport, writes } = withWriteLog(arm.transport)

    await expect(startGame(ctx(transport, JOINER), game.gameId)).rejects.toMatchObject({
      code: 'not_creator',
    })
    expect(writes).toEqual([])
    expect(await shaMap(arm.transport)).toEqual(before)
    expect(parseGameRecord((await arm.transport.get(TEST_STORE, gameObjectName(game.gameId))).value).status).toBe(
      'lobby',
    )
  })

  it('Start flips the status exactly once; a second Start is refused', async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request())
    const context = ctx(arm.transport, CREATOR)
    await joinGame(context, game.gameId)
    await joinGame(ctx(arm.transport, JOINER), game.gameId)

    const { transport, writes } = withWriteLog(arm.transport)
    const started = await startGame(ctx(transport, CREATOR), game.gameId)
    expect(started.status).toBe('started')
    expect(writes).toEqual([`put ${TEST_STORE}/${gameObjectName(game.gameId)}`])

    const afterStart = await shaMap(arm.transport)
    await expect(startGame(ctx(transport, CREATOR), game.gameId)).rejects.toMatchObject({
      code: 'already_started',
    })
    expect(writes).toHaveLength(1)
    expect(await shaMap(arm.transport)).toEqual(afterStart)
    expect(JSON.parse(JSON.stringify(started)).status).toBe('started')
  })

  it('Start refuses a lobby with fewer than two joined players, and writes nothing', async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request())
    await joinGame(ctx(arm.transport, CREATOR), game.gameId)
    const before = await shaMap(arm.transport)
    const { transport, writes } = withWriteLog(arm.transport)
    await expect(startGame(ctx(transport, CREATOR), game.gameId)).rejects.toMatchObject({
      code: 'not_enough_players',
    })
    expect(writes).toEqual([])
    expect(await shaMap(arm.transport)).toEqual(before)
    expect(MIN_PLAYERS_TO_START).toBe(2)
  })

  it('Join is refused for a STARTED game and writes nothing', async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request())
    await joinGame(ctx(arm.transport, CREATOR), game.gameId)
    await joinGame(ctx(arm.transport, JOINER), game.gameId)
    await startGame(ctx(arm.transport, CREATOR), game.gameId)

    const before = await shaMap(arm.transport)
    const { transport, writes } = withWriteLog(arm.transport)
    await expect(joinGame(ctx(transport, THIRD), game.gameId)).rejects.toMatchObject({
      code: 'game_started',
    })
    expect(writes).toEqual([])
    expect(await shaMap(arm.transport)).toEqual(before)
  })

  it('Join is refused for a FULL game and writes nothing', async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request({ maxPlayers: 2 }))
    await joinGame(ctx(arm.transport, CREATOR), game.gameId)
    await joinGame(ctx(arm.transport, JOINER), game.gameId)

    const before = await shaMap(arm.transport)
    const { transport, writes } = withWriteLog(arm.transport)
    await expect(joinGame(ctx(transport, THIRD), game.gameId)).rejects.toMatchObject({
      code: 'game_full',
    })
    expect(writes).toEqual([])
    expect(await shaMap(arm.transport)).toEqual(before)
  })

  it('the creator can re-enter a full or started game without a second object', async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request({ maxPlayers: 2 }))
    const context = ctx(arm.transport, CREATOR)
    await joinGame(context, game.gameId)
    await joinGame(ctx(arm.transport, JOINER), game.gameId)
    await startGame(context, game.gameId)

    const before = await shaMap(arm.transport)
    const { transport, writes } = withWriteLog(arm.transport)
    const again = await joinGame(ctx(transport, CREATOR), game.gameId)
    expect(again.playerId).toBe(CREATOR.id)
    expect(writes).toEqual([])
    expect(await shaMap(arm.transport)).toEqual(before)
  })

  it('Discovery ignores non-game objects and surfaces an unreadable game record', async () => {
    const good = await createGame(ctx(arm.transport, CREATOR), request({ displayName: 'Good Game' }))
    await arm.seed('random.object', '{"hello":1}')
    await arm.seed('g.abc.p.key_5e1a', '{"some":"player"}')
    await arm.seed('g.broken-1111aaaa.game', '{"version":1,"gameId":"broken-1111aaaa"}')
    await arm.seed('g.notjson-2222bbbb.game', 'not json at all')
    await arm.seed('g.other-3333cccc.game', serializeGameRecord({ ...good, gameId: 'other-3333cccc' }))

    const listing = await listGames(ctx(arm.transport, CREATOR))
    expect(listing.games.map((game) => game.gameId).sort()).toEqual(
      [good.gameId, 'other-3333cccc'].sort(),
    )
    expect(listing.unreadable.map((entry) => entry.objectName).sort()).toEqual([
      'g.broken-1111aaaa.game',
      'g.notjson-2222bbbb.game',
    ])
    for (const entry of listing.unreadable) {
      expect(entry.failure.code).toBe('bad_game_record')
      expect(entry.failure.message).not.toBe('')
      expect(entry.failure.title).not.toBe('')
    }
    // "not a game" is in NEITHER list.
    const seen = [
      ...listing.games.map((game) => game.objectName),
      ...listing.unreadable.map((entry) => entry.objectName),
    ]
    expect(seen).not.toContain('random.object')
    expect(seen).not.toContain('g.abc.p.key_5e1a')
  })

  it('Discovery surfaces a game whose object cannot even be fetched', async () => {
    const good = await createGame(ctx(arm.transport, CREATOR), request({ displayName: 'Reachable' }))
    const ghost = 'g.ghost-4444dddd.game'
    await arm.seed(ghost, serializeGameRecord({ ...good, gameId: 'ghost-4444dddd' }))
    const failing: ServerStoreTransport = {
      list: (store) => arm.transport.list(store),
      get: async (store, name) => {
        if (name === ghost) throw new ServerStoreError('not_found', 'it vanished')
        return arm.transport.get(store, name)
      },
      put: (store, name, value) => arm.transport.put(store, name, value),
      remove: (store, name) => arm.transport.remove(store, name),
      whoami: () => arm.transport.whoami(),
    }
    const listing = await listGames(ctx(failing, CREATOR))
    expect(listing.games.map((game) => game.gameId)).toEqual([good.gameId])
    expect(listing.unreadable).toHaveLength(1)
    expect(listing.unreadable[0]!.failure.code).toBe('not_found')
    expect(listing.unreadable[0]!.failure.message).toBe('it vanished')
  })

  it('Discovery reports the player count and whether the caller is already in', async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request())
    await joinGame(ctx(arm.transport, CREATOR), game.gameId)
    await joinGame(ctx(arm.transport, JOINER), game.gameId)

    const asCreator = await listGames(ctx(arm.transport, CREATOR))
    expect(asCreator.games[0]!.playerCount).toBe(2)
    expect(asCreator.games[0]!.alreadyJoined).toBe(true)

    const asJoiner = await listGames(ctx(arm.transport, JOINER))
    expect(asJoiner.games[0]!.alreadyJoined).toBe(true)

    const asStranger = await listGames(ctx(arm.transport, THIRD))
    expect(asStranger.games[0]!.alreadyJoined).toBe(false)
    expect(asStranger.games[0]!.playerCount).toBe(2)
  })

  it('readLobby returns the record and everyone who joined', async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request())
    await joinGame(ctx(arm.transport, CREATOR), game.gameId)
    await joinGame(ctx(arm.transport, JOINER), game.gameId)
    const lobby = await readLobby(ctx(arm.transport, CREATOR), game.gameId)
    expect(lobby.record.gameId).toBe(game.gameId)
    expect(lobby.players.map((player) => player.playerId).sort()).toEqual(
      [CREATOR.id, JOINER.id].sort(),
    )
  })

  it('Leave removes only the caller own object, and leaving twice changes nothing', async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request())
    await joinGame(ctx(arm.transport, CREATOR), game.gameId)
    await joinGame(ctx(arm.transport, JOINER), game.gameId)

    const mine = playerObjectName(game.gameId, playerTagFor(JOINER.id))
    const { transport, writes } = withWriteLog(arm.transport)
    await leaveGame(ctx(transport, JOINER), game.gameId)
    expect(writes).toEqual([`remove ${TEST_STORE}/${mine}`])

    const after = await shaMap(arm.transport)
    expect(Object.keys(after)).not.toContain(mine)
    expect(Object.keys(after)).toContain(gameObjectName(game.gameId))
    expect(Object.keys(after)).toContain(playerObjectName(game.gameId, playerTagFor(CREATOR.id)))

    // Leaving again is the same end state, not an error and not a write.
    const second = withWriteLog(arm.transport)
    await leaveGame(ctx(second.transport, JOINER), game.gameId)
    expect(second.writes).toEqual([])
    expect(await shaMap(arm.transport)).toEqual(after)
  })

  it('Leave refuses to remove an object that belongs to another full id', async () => {
    const game = await createGame(ctx(arm.transport, CREATOR), request())
    await joinGame(ctx(arm.transport, CREATOR), game.gameId)
    const before = await shaMap(arm.transport)
    const { transport, writes } = withWriteLog(arm.transport)
    await expect(leaveGame(ctx(transport, TAG_COLLIDER), game.gameId)).rejects.toMatchObject({
      code: 'player_tag_collision',
    })
    expect(writes).toEqual([])
    expect(await shaMap(arm.transport)).toEqual(before)
  })

  it('no object body and no request body ever contains key material', async () => {
    const keyHash = await sha256Hex(TEST_KEY)
    const context = ctx(arm.transport, CREATOR)

    const game = await createGame(context, request())
    await joinGame(context, game.gameId)
    await joinGame(ctx(arm.transport, JOINER), game.gameId)
    await startGame(context, game.gameId)

    const stored = await bodies(arm.transport)
    expect(stored.length).toBeGreaterThanOrEqual(3)
    const sent = arm.requests.map((call) => call.body).filter((body): body is string => body !== undefined)
    for (const body of [...stored, ...sent]) {
      expect(body).not.toContain(TEST_KEY)
      expect(body).not.toContain(TEST_KEY.toLowerCase())
      expect(body).not.toContain('ssk_')
      expect(body).not.toContain(keyHash)
      expect(body).not.toContain(keyHash.slice(0, 16))
    }
    // ...and the bodies DO carry the identity the lobby is allowed to know.
    expect(stored.join('\n')).toContain(CREATOR.id)
    expect(stored.join('\n')).toContain(JOINER.id)
  })
})

describe('the store name is configuration, never a literal', () => {
  it('defaults to the shared colossus store', () => {
    expect(serverStoreName()).toBe('colossus')
  })

  it('validates an explicit store name at construction, loudly', () => {
    const arm = memoryArm()
    expect(() =>
      lobbyContext({ transport: arm.transport, identity: TEST_IDENTITY, store: 'Bad/Store' }),
    ).toThrow(/illegal store name/)
    expect(lobbyContext({ transport: arm.transport, identity: TEST_IDENTITY }).store).toBe(
      'colossus',
    )
  })

  it('passes the configured store to every transport call', async () => {
    const arm = memoryArm()
    const seen: string[] = []
    const spy: ServerStoreTransport = {
      list: (store) => {
        seen.push(`list ${store}`)
        return arm.transport.list(store)
      },
      get: (store, name) => {
        seen.push(`get ${store}`)
        return arm.transport.get(store, name)
      },
      put: (store, name, value) => {
        seen.push(`put ${store}`)
        return arm.transport.put(store, name, value)
      },
      remove: (store, name) => {
        seen.push(`remove ${store}`)
        return arm.transport.remove(store, name)
      },
      whoami: () => arm.transport.whoami(),
    }
    const game = await createGame(ctx(spy, CREATOR), request())
    await joinGame(ctx(spy, CREATOR), game.gameId)
    expect(seen.every((call) => call.endsWith(` ${TEST_STORE}`))).toBe(true)
    expect(seen.length).toBeGreaterThan(0)
  })
})
