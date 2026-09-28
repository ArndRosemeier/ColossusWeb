/**
 * S9 part B — DELETE a game the caller was a participant in.
 *
 * The owner, verbatim: *"Anybody with a key needs to be able to delete all games
 * that have him as a participant. Right now, games just accumulate."* So the
 * subject is a GAME, and the criterion for "the caller may delete it" is that
 * their OWN `player.<gameid>.<tag>` object exists — the same S5 prefix listing
 * the lobby already uses, never a guess and never a wider reach.
 *
 * These pins run against BOTH transport implementations (`transportHarness.ts`),
 * and every statement is about the objects the store HOLDS afterwards — not about
 * a thrown error, because a delete that half-succeeded and then threw would pass a
 * throw-only test.
 *
 * The measured blocker this slice must handle well: the owner's live keys carry
 * `read,write` and NO `delete` (ServerStore makes `delete` opt-in), so a `403` is
 * the EXPECTED outcome today. It must be reported with the store's own code and
 * message, must NOT be reported as a success, and must say what remains.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  GAME_RECORD_VERSION,
  PLAYER_RECORD_VERSION,
  gameObjectName,
  parseGameRecord,
  playerObjectName,
  playerTagFor,
  serializeGameRecord,
  serializePlayerRecord,
  type GameRecord,
  type PlayerRecord,
} from '../gameRecord'
import {
  GameDeletionError,
  deleteGames,
  deleteRefusalAdvice,
  deletionOrder,
  deletionPlanFor,
  deletionPlanSize,
  leaveGame,
  lobbyContext,
  retryingContext,
  type LobbyContext,
} from '../lobby'
import { SNAPSHOT_SCHEMA_VERSION, serializeSnapshot, snapshotObjectName } from '../snapshot'
import { installKey, forgetKey } from '../keyStore'
import { createRequestRetrier, isRetriable } from '../requestRetry'
import { ServerStoreError, type ServerStoreTransport, type StoreIdentity } from '../transport'
import { TEST_IDENTITY, TEST_KEY, TEST_STORE, httpArm, memoryArm, type Arm } from './transportHarness'

const ARMS: Array<[string, () => Arm]> = [
  ['HTTP implementation (stubbed fetch)', httpArm],
  ['in-memory fake', memoryArm],
]

const CREATOR: StoreIdentity = TEST_IDENTITY
/** First 8 lowercased characters are `aaaa1111` — a second participant. */
const OTHER: StoreIdentity = {
  id: 'AAAA1111zzzz',
  label: 'other',
  stores: ['colossus'],
  perms: ['read', 'write'],
}

function ctx(transport: ServerStoreTransport, identity: StoreIdentity): LobbyContext {
  return lobbyContext({ transport, identity, store: TEST_STORE })
}

function gameRecord(gameId: string, participants: StoreIdentity[]): GameRecord {
  return {
    version: GAME_RECORD_VERSION,
    gameId,
    displayName: `Game ${gameId}`,
    variant: 'Default',
    creator: { id: participants[0]!.id, label: participants[0]!.label },
    status: 'started',
    maxPlayers: 4,
    // A STARTED record must hold >= 2 distinct seats (`requireSeatOrder`), so the
    // fixture is a real record the app's own parser accepts.
    seatOrder: participants.map((participant) => participant.id),
    createdAt: '2026-09-29T09:00:00.000Z',
  }
}

function playerRecord(gameId: string, identity: StoreIdentity): PlayerRecord {
  return {
    version: PLAYER_RECORD_VERSION,
    gameId,
    playerId: identity.id,
    label: identity.label,
    joinedAt: '2026-09-29T09:01:00.000Z',
  }
}

/**
 * A real-looking game: its record, its participants and `snapshots` snapshot
 * objects (chained by `parent`, exactly as `publishSnapshot` writes them). The
 * bodies are the app's OWN serialisers, so the store holds bytes a real client
 * would accept.
 *
 * A `started` record needs >= 2 distinct seats (`requireSeatOrder`), so when a
 * caller names only one participant a filler seat is added — the record must be
 * one the app's own parser accepts, or the fixture would prove nothing.
 */
const FILLER: StoreIdentity = {
  id: 'FFFF0000aaaa',
  label: 'filler',
  stores: ['colossus'],
  perms: ['read', 'write'],
}

async function seedGame(
  transport: ServerStoreTransport,
  gameId: string,
  participants: StoreIdentity[],
  snapshots: number,
): Promise<{ snapshotNames: string[]; playerNames: string[]; all: string[] }> {
  const seats = participants.length >= 2 ? participants : [...participants, FILLER]
  const record = gameRecord(gameId, seats)
  const all: string[] = [gameObjectName(gameId)]
  await transport.put(TEST_STORE, gameObjectName(gameId), serializeGameRecord(record))
  const playerNames: string[] = []
  for (const participant of seats) {
    const name = playerObjectName(gameId, playerTagFor(participant.id))
    playerNames.push(name)
    all.push(name)
    await transport.put(TEST_STORE, name, serializePlayerRecord(playerRecord(gameId, participant)))
  }
  const snapshotNames: string[] = []
  let parent: string | null = null
  for (let seq = 0; seq < snapshots; seq++) {
    const tag = playerTagFor(participants[0]!.id)
    const name = snapshotObjectName(gameId, 1, seq, tag)
    const body = {
      header: {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        name,
        gameId,
        turn: 1,
        seq,
        writerTag: tag,
        seat: 0,
        parent,
        createdAt: '2026-09-29T10:00:00.000Z',
      },
      state: {
        version: 1,
        savedAt: '2026-09-29T10:00:00.000Z',
        variantName: 'Default',
        state: {},
      },
    }
    await transport.put(TEST_STORE, name, serializeSnapshot(body))
    parent = name
    snapshotNames.push(name)
    all.push(name)
  }
  return { snapshotNames, playerNames, all }
}

/** The participants a seeded game really has (>= 2: the filler is added if needed). */
function seated(participants: StoreIdentity[]): StoreIdentity[] {
  return participants.length >= 2 ? participants : [...participants, FILLER]
}

async function names(transport: ServerStoreTransport): Promise<string[]> {
  return (await transport.list(TEST_STORE)).map((object) => object.name).sort()
}

/** A sha256 per object — the byte check that another game was not touched. */
async function shaMap(transport: ServerStoreTransport): Promise<Record<string, string>> {
  const objects = await transport.list(TEST_STORE)
  return Object.fromEntries(objects.map((object) => [object.name, object.sha256]))
}

describe.each(ARMS)('%s — deleting a game the caller was in', (_name, makeArm) => {
  let arm: Arm

  beforeEach(() => {
    arm = makeArm()
    forgetKey()
    installKey(TEST_KEY)
  })

  it('PIN 1: deletes the record, EVERY player object and EVERY snapshot of THAT game — and nothing else', async () => {
    const mine = await seedGame(arm.transport, 'mine-0001abcd', [CREATOR, OTHER], 12)
    const theirs = await seedGame(arm.transport, 'theirs-0001abcd', [OTHER], 3)
    const before = await shaMap(arm.transport)

    const result = await deleteGames(ctx(arm.transport, CREATOR), 'mine-0001abcd')

    expect(result.gameId).toBe('mine-0001abcd')
    expect(result.total).toBe(12 + seated([CREATOR, OTHER]).length + 1)
    expect(result.deleted.sort()).toEqual(
      [
        gameObjectName('mine-0001abcd'),
        ...mine.playerNames,
        ...mine.snapshotNames,
      ].sort(),
    )
    // Gone: every object of the caller's game.
    const left = await names(arm.transport)
    for (const name of result.deleted) expect(left).not.toContain(name)
    // Untouched: the OTHER game's objects, byte for byte.
    for (const name of [gameObjectName('theirs-0001abcd'), ...theirs.playerNames, ...theirs.snapshotNames]) {
      expect(left).toContain(name)
      const now = await shaMap(arm.transport)
      expect(now[name]).toBe(before[name])
    }
  })

  it('PIN 2: THE RECORD GOES LAST — the order is snapshots, then players, then the record', async () => {
    const seeded = await seedGame(arm.transport, 'order-0001abcd', [CREATOR], 4)
    const plan = await deletionPlanFor(ctx(arm.transport, CREATOR), 'order-0001abcd')

    expect(deletionOrder(plan)).toEqual([
      ...seeded.snapshotNames,
      ...plan.players.map((object) => object.name),
      gameObjectName('order-0001abcd'),
    ])
    // And the plan counts the whole job, so the confirmation can name it.
    expect(deletionPlanSize(plan)).toBe(4 + seated([CREATOR]).length + 1)

    const seen: string[] = []
    await deleteGames(ctx(arm.transport, CREATOR), 'order-0001abcd', {
      onProgress: (progress) => seen.push(progress.current),
    })
    expect(seen).toEqual(deletionOrder(plan))
  })

  it('PIN 3: a failure part-way leaves the game VISIBLE (the record is still there)', async () => {
    const seeded = await seedGame(arm.transport, 'partial-0001abcd', [CREATOR], 5)
    const order = deletionOrder(await deletionPlanFor(ctx(arm.transport, CREATOR), 'partial-0001abcd'))
    const refused = seeded.playerNames[0]!
    const at = order.indexOf(refused)
    // A player object comes after every snapshot and before the record: exactly
    // the "died half way" case.
    expect(at).toBeGreaterThan(0)
    expect(order[order.length - 1]).toBe(gameObjectName('partial-0001abcd'))
    const transport = failOn(
      arm.transport,
      `remove ${TEST_STORE}/${refused}`,
      new ServerStoreError('forbidden', 'this key may not delete', 403),
    )

    const failure = await deleteGames(ctx(transport, CREATOR), 'partial-0001abcd').catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(GameDeletionError)
    const error = failure as GameDeletionError
    expect(error.code).toBe('forbidden')
    expect(error.error.message).toBe('this key may not delete')
    expect(error.forbidden).toBe(true)
    // EXACTLY what happened: everything before the refusal is gone, everything
    // from it onward — the RECORD included — is not.
    expect(error.deleted).toEqual(order.slice(0, at))
    expect(error.remaining).toEqual(order.slice(at))
    expect(error.remaining).toContain(gameObjectName('partial-0001abcd'))
    // The lobby can still SEE it, and it is still deletable.
    const left = await names(arm.transport)
    expect(left).toContain(gameObjectName('partial-0001abcd'))
  })

  it('PIN 4: a `403` (the owner’s TODAY case) is LOUD, names the store’s own code and message, and claims NO success', async () => {
    const seeded = await seedGame(arm.transport, 'forbidden-0001abcd', [CREATOR], 3)
    // ServerStore makes `delete` opt-in; the owner's live keys are `read,write`.
    const refusal = new ServerStoreError('forbidden', 'key is not allowed to delete objects', 403)
    const transport = failOn(
      arm.transport,
      `remove ${TEST_STORE}/${seeded.snapshotNames[0]!}`,
      refusal,
    )

    const failure = await deleteGames(ctx(transport, CREATOR), 'forbidden-0001abcd').catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(GameDeletionError)
    const error = failure as GameDeletionError
    expect(error.code).toBe('forbidden')
    expect(error.error.status).toBe(403)
    expect(error.error.message).toBe('key is not allowed to delete objects')
    expect(error.forbidden).toBe(true)
    // NOTHING was deleted, and the error says so.
    expect(error.deleted).toEqual([])
    expect(error.remaining).toHaveLength(3 + seated([CREATOR]).length + 1)
    // The actionable sentence, worded ONCE in `lobby.ts`.
    const advice = deleteRefusalAdvice(error)
    expect(advice).toContain('ask the operator to grant the delete permission')
    expect(advice).toContain('nothing was removed')
    // The game is untouched and still listed — the app must not claim otherwise.
    const left = await names(arm.transport)
    expect(left).toContain(gameObjectName('forbidden-0001abcd'))
    expect(left).toHaveLength(3 + seated([CREATOR]).length + 1)
  })

  it('PIN 5: a caller cannot delete a game they were NOT a participant in, and one object stays', async () => {
    await seedGame(arm.transport, 'notmine-0001abcd', [OTHER], 4)
    const before = await names(arm.transport)

    const failure = await deleteGames(ctx(arm.transport, CREATOR), 'notmine-0001abcd').catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(ServerStoreError)
    expect((failure as ServerStoreError).code).toBe('not_a_participant')
    expect((failure as ServerStoreError).message).toContain(
      playerObjectName('notmine-0001abcd', playerTagFor(CREATOR.id)),
    )
    // NOTHING was planned, NOTHING was deleted.
    expect(await names(arm.transport)).toEqual(before)
  })

  it('PIN 6: deleting an unknown game is a LOUD not_found, and writes nothing', async () => {
    const failure = await deleteGames(ctx(arm.transport, CREATOR), 'ghost-0001abcd').catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(ServerStoreError)
    expect((failure as ServerStoreError).code).toBe('not_found')
  })

  it('PIN 7: a rate limit is WAITED OUT by the retrier, and the delete then finishes', async () => {
    await seedGame(arm.transport, 'slow-0001abcd', [CREATOR], 3)
    const context = ctx(arm.transport, CREATOR)
    let attempts = 0
    const waits: number[] = []
    const transport = failOnce(
      arm.transport,
      `remove ${TEST_STORE}/snap.slow-0001abcd.0001.000.${playerTagFor(CREATOR.id)}`,
      new ServerStoreError('rate_limited', 'slow down', 429, 3),
      () => {
        attempts += 1
      },
    )
    const retrying = retryingContext(ctx(transport, CREATOR), (run) =>
      createRequestRetrier({
        sleep: async (ms) => {
          waits.push(ms)
        },
      })(run),
    )
    const result = await deleteGames(retrying, 'slow-0001abcd')
    expect(attempts).toBe(1)
    // Obeyed the store's own Retry-After (3s), not the backoff.
    expect(waits).toEqual([3000])
    expect(result.deleted).toHaveLength(3 + seated([CREATOR]).length + 1)
    expect(await names(arm.transport)).not.toContain(gameObjectName('slow-0001abcd'))
    expect(context.store).toBe(TEST_STORE)
  })

  it('PIN 8: the retrier retries the STORE’s refusals and never our own guards', () => {
    expect(isRetriable(new ServerStoreError('rate_limited', 'x', 429, 1))).toBe(true)
    expect(isRetriable(new ServerStoreError('conflict', 'x', 409))).toBe(true)
    expect(isRetriable(new ServerStoreError('transport_error', 'x'))).toBe(true)
    // Our own boundary guards: no status, and retrying them changes nothing.
    expect(isRetriable(new ServerStoreError('invalid_name', 'x'))).toBe(false)
    expect(isRetriable(new ServerStoreError('bad_game_record', 'x'))).toBe(false)
    expect(isRetriable(new Error('not a store error'))).toBe(false)
  })

  it('PIN 9: an object that is already GONE is not a failure and is not claimed as deleted', async () => {
    const seeded = await seedGame(arm.transport, 'race-0001abcd', [CREATOR], 3)
    // Another client removes one snapshot between our listing and our DELETE, so
    // the store answers `not_found` for a name the plan still holds.
    const gone = seeded.snapshotNames[1]!
    const transport = failOnce(
      arm.transport,
      `remove ${TEST_STORE}/${gone}`,
      new ServerStoreError('not_found', `no object ${gone}`, 404),
      () => {},
    )
    const result = await deleteGames(ctx(transport, CREATOR), 'race-0001abcd')
    expect(result.absent).toEqual([gone])
    expect(result.deleted).not.toContain(gone)
    expect(result.deleted).toHaveLength(3 + seated([CREATOR]).length + 1 - 1)
    expect(await names(arm.transport)).not.toContain(gameObjectName('race-0001abcd'))
  })

  it('PIN 10: `leaveGame` still removes only the caller’s OWN object — deleting is a DIFFERENT action', async () => {
    const seeded = await seedGame(arm.transport, 'leave-0001abcd', [CREATOR, OTHER], 2)
    await leaveGame(ctx(arm.transport, CREATOR), 'leave-0001abcd')
    const left = await names(arm.transport)
    expect(left).not.toContain(playerObjectName('leave-0001abcd', playerTagFor(CREATOR.id)))
    // Every other object is still there: Leave is not a delete.
    expect(left).toContain(gameObjectName('leave-0001abcd'))
    expect(left).toContain(playerObjectName('leave-0001abcd', playerTagFor(OTHER.id)))
    for (const name of seeded.snapshotNames) expect(left).toContain(name)
  })

  it('PIN 11: a game whose record is unreadable is refused BEFORE anything is deleted', async () => {
    await seedGame(arm.transport, 'corrupt-0001abcd', [CREATOR], 2)
    await arm.transport.put(TEST_STORE, gameObjectName('corrupt-0001abcd'), '{not json')
    const before = await names(arm.transport)
    const failure = await deletionPlanFor(ctx(arm.transport, CREATOR), 'corrupt-0001abcd').catch(
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(ServerStoreError)
    expect((failure as ServerStoreError).code).toBe('bad_game_record')
    expect(await names(arm.transport)).toEqual(before)
  })

  it('PIN 12: the plan names the object count, so the confirmation can say what goes', async () => {
    await seedGame(arm.transport, 'count-0001abcd', [CREATOR, OTHER], 100)
    const plan = await deletionPlanFor(ctx(arm.transport, CREATOR), 'count-0001abcd')
    // A long game really is 100+ objects: 100 snapshots + 2 players + the record.
    expect(deletionPlanSize(plan)).toBe(100 + seated([CREATOR, OTHER]).length + 1)
    const progress: number[] = []
    const result = await deleteGames(ctx(arm.transport, CREATOR), 'count-0001abcd', {
      onProgress: (p) => progress.push(p.done),
    })
    expect(result.deleted).toHaveLength(100 + seated([CREATOR, OTHER]).length + 1)
    // Progress is reported from 0 and never repeats, so the line can count up.
    expect(progress).toEqual([...Array(100 + seated([CREATOR, OTHER]).length + 1).keys()])
  })
})

/**
 * Wrap a transport so ONE matched call fails. `match` is `"<method> <store>/<name>"`
 * — the same shape `memoryTransport`'s own scripted failures use, so the fake and
 * the real arm are driven identically.
 */
function failOn(
  base: ServerStoreTransport,
  match: string,
  error: ServerStoreError,
): ServerStoreTransport {
  return failingTransport(base, () => match, error)
}

/** Fail the matched call on its FIRST attempt only, counting the attempt. */
function failOnce(
  base: ServerStoreTransport,
  match: string,
  error: ServerStoreError,
  onFail: () => void,
): ServerStoreTransport {
  let used = false
  return failingTransport(
    base,
    () => match,
    error,
    () => {
      if (used) return false
      used = true
      onFail()
      return true
    },
  )
}

function failingTransport(
  base: ServerStoreTransport,
  match: () => string,
  error: ServerStoreError,
  shouldFail: () => boolean = () => true,
): ServerStoreTransport {
  const guard = <T>(method: string, store: string, name: string | undefined, run: () => Promise<T>) => {
    const key = name === undefined ? `${method} ${store}` : `${method} ${store}/${name}`
    if (key === match() && shouldFail()) return Promise.reject(error) as Promise<T>
    return run()
  }
  return {
    list: (store, prefix) => guard('list', store, undefined, () => base.list(store, prefix)),
    get: (store, name) => guard('get', store, name, () => base.get(store, name)),
    put: (store, name, value) => guard('put', store, name, () => base.put(store, name, value)),
    remove: (store, name) => guard('remove', store, name, () => base.remove(store, name)),
    whoami: () => base.whoami(),
  }
}

describe('S9-B · the delete plan parses the record it is about to remove', () => {
  it('a plan built from a started record keeps the record name exactly', async () => {
    const arm = memoryArm()
    forgetKey()
    installKey(TEST_KEY)
    await seedGame(arm.transport, 'plan-0001abcd', [CREATOR], 1)
    const plan = await deletionPlanFor(ctx(arm.transport, CREATOR), 'plan-0001abcd')
    expect(plan.record).toBe(gameObjectName('plan-0001abcd'))
    expect(parseGameRecord((await arm.transport.get(TEST_STORE, plan.record)).value).gameId).toBe(
      'plan-0001abcd',
    )
  })
})
