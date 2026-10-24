/**
 * The host's rules, pure: who may move, which moves are stale, who may join, and
 * what a malformed world is. `session.test.ts` drives the same rules over the
 * (fake) wire.
 */
import { describe, expect, it } from 'vitest'
import { createGame } from '../../engine/GameEngine'
import { loadDefaultVariant } from '../../engine/__tests__/helpers'
import { serializeGame } from '../../persistence/saveGame'
import { newToken } from '../identity'
import {
  createWorld,
  hostDisconnect,
  hostHandle,
  hostReconcile,
  parseRoomMeta,
  parseWorld,
  roomMeta,
  startRefusal,
  startWorld,
  type RoomWorld,
} from '../room'
import { multiplayerSeatOptions } from '../sync'

const variant = loadDefaultVariant()
const A = newToken()
const B = newToken()

function lobby(maxPlayers = 2): RoomWorld {
  const world = createWorld({ displayName: 'T', variant: 'Default', maxPlayers, creator: { token: A, name: 'A' }, conn: 1 })
  return hostHandle(world, { t: 'hello', token: B, name: 'B', heldRev: null, gameId: null }, 2).world
}

function started(): RoomWorld {
  const world = lobby()
  const game = createGame(variant, { ...multiplayerSeatOptions(world), variantName: 'Default' })
  return startWorld(world, serializeGame(game))
}

describe('joining', () => {
  it('a hello adds a member once; a second hello from the same token only moves its connection', () => {
    const world = lobby(4)
    expect(world.members.map((m) => [m.name, m.conn])).toEqual([
      ['A', 1],
      ['B', 2],
    ])
    const again = hostHandle(world, { t: 'hello', token: B, name: 'B', heldRev: null, gameId: null }, 7).world
    expect(again.members.map((m) => [m.name, m.conn])).toEqual([
      ['A', 1],
      ['B', 7],
    ])
  })

  it('a full lobby replies game_full and changes nothing', () => {
    const world = lobby(2)
    const outcome = hostHandle(world, { t: 'hello', token: newToken(), name: 'C', heldRev: null, gameId: null }, 3)
    expect(outcome.world).toBe(world)
    expect(outcome.reply).toMatchObject({ t: 'rejected', code: 'game_full' })
  })

  it('a started game takes a newcomer as a watcher, never as a seat', () => {
    const world = started()
    const watcher = newToken()
    const next = hostHandle(world, { t: 'hello', token: watcher, name: 'W', heldRev: null, gameId: null }, 9).world
    expect(next.members).toHaveLength(3)
    expect(next.seats).toEqual([A, B])
  })

  it('Start needs two players, and seats them in join order', () => {
    const alone = createWorld({ displayName: 'T', variant: 'Default', maxPlayers: 2, creator: { token: A, name: 'A' }, conn: 1 })
    expect(startRefusal(alone)?.code).toBe('not_enough_players')
    const world = started()
    expect(world.status).toBe('started')
    expect(world.seats).toEqual([A, B])
    expect(startRefusal(world)?.code).toBe('already_started')
  })
})

describe('moves', () => {
  it('the acting seat moves; the rev advances and records who moved', () => {
    const world = started()
    const outcome = hostHandle(world, { t: 'commit', token: A, base: world.rev, game: world.game! }, 1)
    expect(outcome.reply).toBeNull()
    expect(outcome.world.rev).toBe(world.rev + 1)
    expect(outcome.world.lastBy).toBe(A)
  })

  it('refuses out of turn, out of date, and unseated', () => {
    const world = started()
    const code = (token: string, base: number, from: number) =>
      (hostHandle(world, { t: 'commit', token, base, game: world.game! }, from).reply as { code?: string } | null)?.code
    expect(code(B, world.rev, 2)).toBe('not_your_turn')
    expect(code(A, world.rev - 1, 1)).toBe('stale_move')
    expect(code(newToken(), world.rev, 5)).toBe('not_seated')
  })

  it('a seat moves from ANY tab of its browser: a second tab took the conn, the first still moves', () => {
    // Tab 2 of A's browser (same token) says hello on conn 7 and takes the seat's conn.
    const world = hostHandle(started(), { t: 'hello', token: A, name: 'A', heldRev: null, gameId: null }, 7).world
    expect(world.members.find((m) => m.token === A)!.conn).toBe(7)
    // Tab 1 (conn 1) splits: accepted, and the seat is bound to the tab that moved.
    const outcome = hostHandle(world, { t: 'commit', token: A, base: world.rev, game: world.game! }, 1)
    expect(outcome.reply).toBeNull()
    expect(outcome.world.rev).toBe(world.rev + 1)
    expect(outcome.world.members.find((m) => m.token === A)!.conn).toBe(1)
  })

  it('refuses a game of another variant', () => {
    const world = started()
    const game = { ...world.game!, variantName: 'Abyssal6' }
    const outcome = hostHandle(world, { t: 'commit', token: A, base: world.rev, game }, 1)
    expect(outcome.reply).toMatchObject({ code: 'bad_world' })
  })
})

describe('presence and backups', () => {
  it('a dropped connection marks its member away; a new host reconciles stale connections', () => {
    const world = started()
    expect(hostDisconnect(world, 2).members.find((m) => m.token === B)!.conn).toBeNull()
    expect(hostReconcile(world, new Set([1])).members.find((m) => m.token === B)!.conn).toBeNull()
    expect(hostReconcile(world, new Set([1, 2]))).toBe(world)
  })

  it('a seated rejoiner holding a NEWER rev is asked for its copy, which then replaces the older one', () => {
    const world = started()
    const newer: RoomWorld = { ...world, rev: world.rev + 5 }
    const hello = hostHandle(world, { t: 'hello', token: B, name: 'B', heldRev: newer.rev, gameId: world.gameId }, 4)
    expect(hello.reply).toEqual({ t: 'send-backup' })
    const taken = hostHandle(hello.world, { t: 'backup', world: newer }, 4).world
    expect(taken.rev).toBe(newer.rev)
    expect(taken.members.find((m) => m.token === B)!.conn).toBe(4)
    // An older or foreign copy is ignored.
    expect(hostHandle(world, { t: 'backup', world: { ...world, rev: 0 } }, 4).world).toBe(world)
    expect(hostHandle(world, { t: 'backup', world: { ...newer, gameId: 'g_other' } }, 4).world).toBe(world)
  })
})

describe('parsing', () => {
  it('a world round-trips; a malformed one is a LOUD bad_world', () => {
    const world = started()
    expect(parseWorld(JSON.parse(JSON.stringify(world)))).toEqual(world)
    expect(() => parseWorld({ ...world, seats: [] })).toThrow(/at least 2 seats/)
    expect(() => parseWorld({ ...world, kind: 'tank' })).toThrow(/not a Colossus game/)
    expect(() => parseWorld({ ...world, v: 99 })).toThrow(/protocol 99/)
  })

  it('only Colossus rooms of this protocol are listed', () => {
    const meta = roomMeta(started())
    expect(parseRoomMeta(meta)).toEqual(meta)
    expect(parseRoomMeta({ mode: 'arena' })).toBeNull()
    expect(parseRoomMeta({ ...meta, v: 2 })).toBeNull()
  })
})
