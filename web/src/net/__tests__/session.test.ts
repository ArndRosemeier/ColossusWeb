/**
 * Online play end to end over the in-memory GameHub (`fakeHub.ts`): lobby,
 * Start, moves, refusals, host migration, reconnect, and re-opening a game whose
 * room has closed. Each "browser" is a real `HubSession`; only the socket is fake.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createGame } from '../../engine/GameEngine'
import type { GameState } from '../../engine/types'
import { loadDefaultVariant } from '../../engine/__tests__/helpers'
import { deserializeGame } from '../../persistence/saveGame'
import { NetError } from '../failure'
import type { HubConfig } from '../hubConfig'
import { newToken } from '../identity'
import { HubSession, type HubConnect } from '../session'
import { multiplayerSeatOptions } from '../sync'
import { FakeHubServer, type FakeClient } from './fakeHub'

const CONFIG: HubConfig = { url: 'https://hub.test', app: 'colossus', appKey: 'ghk_test', access: false }
const variant = loadDefaultVariant()

let sessions: HubSession[] = []
afterEach(() => {
  for (const s of sessions) s.close()
  sessions = []
})

function browser(server: FakeHubServer, name: string): HubSession {
  const session = new HubSession({
    player: { token: newToken(), name },
    connect: server.connect as unknown as HubConnect,
    config: () => CONFIG,
    retryDelayMs: () => 0,
  })
  sessions.push(session)
  return session
}

/** The fake socket a session is on right now. */
function socketOf(server: FakeHubServer, session: HubSession): FakeClient {
  const id = session.you
  const client = [...server.clients].find((c) => c.id === id)
  if (!client) throw new Error('no socket')
  return client
}

/** The host builds the opening board exactly as `App.enterOnline` does. */
function startAsHost(host: HubSession): GameState {
  const world = host.getSnapshot().world!
  const opening = createGame(variant, { ...multiplayerSeatOptions(world), variantName: world.variant })
  host.startGame(opening)
  return opening
}

/** What a client's screen would show for the current world. */
function shown(session: HubSession): GameState {
  return deserializeGame(session.getSnapshot().world!.game!, variant)
}

/** A "move": the same game with the turn handed to `seat`. */
function handTurnTo(state: GameState, seat: number, note: string): GameState {
  const { variant: v, ...rest } = state
  return { ...structuredClone(rest), variant: v, activePlayerIndex: seat, message: note }
}

async function lobbyOfTwo(server: FakeHubServer) {
  const alice = browser(server, 'Alice')
  const bob = browser(server, 'Bob')
  await alice.create({ displayName: 'Friday Titan', variant: 'Default', maxPlayers: 2 })
  await bob.start()
  await server.settle()
  const room = bob.getSnapshot().rooms[0]!
  await bob.join(room.code)
  await server.settle()
  return { alice, bob, code: room.code }
}

describe('configuration', () => {
  it('a build without an app key is a LOUD hub_not_configured, not a silent socket', async () => {
    const server = new FakeHubServer()
    const session = new HubSession({
      player: { token: newToken(), name: 'A' },
      connect: server.connect as unknown as HubConnect,
      config: () => {
        throw new NetError('hub_not_configured', 'no key')
      },
    })
    await expect(session.start()).rejects.toThrow('no key')
    expect(session.getSnapshot().failure?.code).toBe('hub_not_configured')
    expect(server.connects).toHaveLength(0)
  })
})

describe('the lobby', () => {
  it('a created game is listed live for others, with its variant and seat count', async () => {
    const server = new FakeHubServer()
    const alice = browser(server, 'Alice')
    const bob = browser(server, 'Bob')
    await bob.start()
    await alice.create({ displayName: 'Friday Titan', variant: 'Default', maxPlayers: 4 })
    await server.settle()
    const rooms = bob.getSnapshot().rooms
    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.name).toBe('Friday Titan')
    expect(rooms[0]!.meta).toMatchObject({ variant: 'Default', status: 'lobby', maxPlayers: 4, members: 1 })
    expect(alice.getSnapshot().isHost).toBe(true)
  })

  it('a join appears on the host at once, and the joiner mirrors the world', async () => {
    const server = new FakeHubServer()
    const { alice, bob } = await lobbyOfTwo(server)
    expect(alice.getSnapshot().world!.members.map((m) => m.name)).toEqual(['Alice', 'Bob'])
    expect(bob.getSnapshot().world!.members.map((m) => m.name)).toEqual(['Alice', 'Bob'])
    expect(bob.getSnapshot().isHost).toBe(false)
    // The lobby row counts the join.
    expect(bob.getSnapshot().rooms[0]!.meta.members).toBe(2)
  })

  it('a full lobby refuses another player loudly and lets them go', async () => {
    const server = new FakeHubServer()
    const { alice } = await lobbyOfTwo(server)
    const carol = browser(server, 'Carol')
    await carol.join(alice.getSnapshot().code!)
    await server.settle()
    expect(carol.getSnapshot().failure?.code).toBe('game_full')
    expect(carol.getSnapshot().code).toBeNull()
    expect(alice.getSnapshot().world!.members).toHaveLength(2)
  })

  it('leaving a lobby gives up the place', async () => {
    const server = new FakeHubServer()
    const { alice, bob } = await lobbyOfTwo(server)
    await bob.leave()
    await server.settle()
    expect(alice.getSnapshot().world!.members.map((m) => m.name)).toEqual(['Alice'])
    expect(bob.getSnapshot().world).toBeNull()
  })
})

describe('Start and moves', () => {
  it('Start seats everyone in join order and moves both clients into the same game', async () => {
    const server = new FakeHubServer()
    const { alice, bob } = await lobbyOfTwo(server)
    const before = bob.getSnapshot().adoptSeq
    const opening = startAsHost(alice)
    await server.settle()
    const world = bob.getSnapshot().world!
    expect(world.status).toBe('started')
    expect(world.seats).toEqual([alice.token, bob.token])
    expect(bob.getSnapshot().adoptSeq).toBeGreaterThan(before)
    expect(shown(bob).players.map((p) => p.name)).toEqual(['Alice', 'Bob'])
    expect(shown(bob).legions.map((l) => l.hexLabel)).toEqual(opening.legions.map((l) => l.hexLabel))
    expect(bob.getSnapshot().rooms[0]!.meta.status).toBe('started')
  })

  it('a move by the acting seat reaches the other client; a move out of turn is refused and rolled back', async () => {
    const server = new FakeHubServer()
    const { alice, bob } = await lobbyOfTwo(server)
    const opening = startAsHost(alice)
    await server.settle()

    // Bob is not the acting seat at the opening.
    const seqBefore = bob.getSnapshot().adoptSeq
    bob.commit(handTurnTo(opening, 1, 'bob cheats'))
    await server.settle()
    expect(bob.getSnapshot().failure?.code).toBe('not_your_turn')
    // Bob's screen is told to re-adopt the host's (unchanged) state.
    expect(bob.getSnapshot().adoptSeq).toBe(seqBefore + 1)
    expect(alice.getSnapshot().world!.rev).toBe(1)

    // Alice (the host) moves and hands the turn to Bob.
    alice.commit(handTurnTo(opening, 1, 'alice moved'))
    await server.settle()
    expect(bob.getSnapshot().world!.rev).toBe(2)
    expect(shown(bob).message).toBe('alice moved')
    expect(bob.getSnapshot().adoptSeq).toBe(seqBefore + 2)
  })

  it("a non-host's quick successive moves are all accepted, and its own echoes are not re-adopted", async () => {
    const server = new FakeHubServer()
    const { alice, bob } = await lobbyOfTwo(server)
    const opening = startAsHost(alice)
    alice.commit(handTurnTo(opening, 1, 'to bob'))
    await server.settle()
    const seq = bob.getSnapshot().adoptSeq
    const aliceSeq = alice.getSnapshot().adoptSeq

    const bobTurn = shown(bob)
    bob.commit(handTurnTo(bobTurn, 1, 'bob split'))
    bob.commit(handTurnTo(bobTurn, 1, 'bob moved'))
    await server.settle()
    expect(bob.getSnapshot().failure).toBeNull()
    expect(alice.getSnapshot().world!.rev).toBe(4)
    expect(shown(alice).message).toBe('bob moved')
    // The host's screen adopted both; Bob's never jumped back to its own echo.
    expect(alice.getSnapshot().adoptSeq).toBe(aliceSeq + 2)
    expect(bob.getSnapshot().adoptSeq).toBe(seq)
  })

  it('a move built on an old state is refused as stale', async () => {
    const server = new FakeHubServer()
    const { alice, bob } = await lobbyOfTwo(server)
    const opening = startAsHost(alice)
    await server.settle()
    // An engagement lets both act; simulate Bob sending against rev 0.
    const client = socketOf(server, bob)
    client.send({ t: 'commit', token: bob.token, base: 0, game: alice.getSnapshot().world!.game }, alice.you!)
    await server.settle()
    const replies = socketOf(server, alice).sent.filter((m) => (m.data as { t: string }).t === 'rejected')
    expect(replies.map((m) => (m.data as { code: string }).code)).toEqual(['stale_move'])
    expect(opening).toBeDefined()
  })
})

describe('host migration, reconnect and re-open', () => {
  it('when the host drops, another player hosts on from its copy; the host comes back to its seat', async () => {
    const server = new FakeHubServer()
    const { alice, bob, code } = await lobbyOfTwo(server)
    const opening = startAsHost(alice)
    alice.commit(handTurnTo(opening, 1, 'to bob'))
    await server.settle()

    const oldConn = alice.you
    socketOf(server, alice).drop()
    await server.settle()
    expect(bob.getSnapshot().isHost).toBe(true)
    const world = bob.getSnapshot().world!
    expect(world.rev).toBe(2)
    // The old connection is released (Alice may already be back on a new one).
    expect(world.members.find((m) => m.token === alice.token)!.conn).not.toBe(oldConn)

    // Bob keeps playing as host.
    bob.commit(handTurnTo(shown(bob), 0, 'bob moved'))
    await server.settle(40)

    // Alice's session reconnected by itself and rejoined the same room.
    expect(alice.getSnapshot().connection).toBe('online')
    expect(alice.getSnapshot().code).toBe(code)
    expect(alice.getSnapshot().isHost).toBe(false)
    expect(alice.getSnapshot().world!.rev).toBe(3)
    expect(shown(alice).message).toBe('bob moved')
    expect(bob.getSnapshot().world!.members.find((m) => m.token === alice.token)!.conn).toBe(alice.you)
    // ...and it is her turn again, through the host's rules.
    alice.commit(handTurnTo(shown(alice), 1, 'alice again'))
    await server.settle()
    expect(bob.getSnapshot().world!.rev).toBe(4)
  })

  it('a move that died with the old host is applied by the player who takes over', async () => {
    const server = new FakeHubServer()
    const { alice, bob } = await lobbyOfTwo(server)
    const opening = startAsHost(alice)
    alice.commit(handTurnTo(opening, 1, 'to bob'))
    await server.settle()

    bob.commit(handTurnTo(shown(bob), 0, 'bob in flight'))
    socketOf(server, alice).drop() // before the host could read it
    await server.settle()
    expect(bob.getSnapshot().isHost).toBe(true)
    expect(bob.getSnapshot().world!.rev).toBe(3)
    expect(shown(bob).message).toBe('bob in flight')
  })

  it('a game whose room closed is re-opened from a local copy, and the others find it by its game id', async () => {
    const server = new FakeHubServer()
    const { alice, bob } = await lobbyOfTwo(server)
    const opening = startAsHost(alice)
    alice.commit(handTurnTo(opening, 1, 'to bob'))
    await server.settle()
    const gameId = alice.getSnapshot().world!.gameId
    const copy = bob.getSnapshot().world!

    // Everyone goes away; the server forgets the room.
    alice.close()
    bob.close()
    await server.settle()
    server.expireEmptyRooms()

    // Bob comes back first and re-opens from his copy.
    const bob2 = new HubSession({
      player: { token: bob.token, name: 'Bob' },
      connect: server.connect as unknown as HubConnect,
      config: () => CONFIG,
    })
    sessions.push(bob2)
    await bob2.reopen(copy)
    await server.settle()
    expect(bob2.getSnapshot().isHost).toBe(true)

    const alice2 = new HubSession({
      player: { token: alice.token, name: 'Alice' },
      connect: server.connect as unknown as HubConnect,
      config: () => CONFIG,
    })
    sessions.push(alice2)
    await alice2.start()
    await server.settle()
    const live = alice2.findRoomFor(gameId)
    expect(live).not.toBeNull()
    await alice2.join(live!.code)
    await server.settle()
    expect(alice2.getSnapshot().world!.seats).toEqual([alice.token, bob.token])
    expect(shown(alice2).message).toBe('to bob')
    bob2.commit(handTurnTo(shown(bob2), 0, 'bob moved after reopen'))
    await server.settle()
    expect(shown(alice2).message).toBe('bob moved after reopen')
  })

  it("a rejoining player's NEWER copy replaces an older re-opened one", async () => {
    const server = new FakeHubServer()
    const { alice, bob } = await lobbyOfTwo(server)
    const opening = startAsHost(alice)
    const stale = alice.getSnapshot().world! // rev 1
    alice.commit(handTurnTo(opening, 1, 'newest'))
    await server.settle()
    const fresh = bob.getSnapshot().world! // rev 2
    expect(fresh.rev).toBe(2)
    alice.close()
    bob.close()
    await server.settle()
    server.expireEmptyRooms()

    const alice2 = new HubSession({
      player: { token: alice.token, name: 'Alice' },
      connect: server.connect as unknown as HubConnect,
      config: () => CONFIG,
    })
    sessions.push(alice2)
    await alice2.reopen(stale)
    await server.settle()

    // Bob rejoins holding rev 2: the host asks for his copy and takes it.
    const bob2 = new HubSession({
      player: { token: bob.token, name: 'Bob' },
      connect: server.connect as unknown as HubConnect,
      config: () => CONFIG,
    })
    sessions.push(bob2)
    bob2.restoreCopy(fresh)
    await bob2.join(alice2.getSnapshot().code!)
    await server.settle()
    expect(alice2.getSnapshot().world!.rev).toBe(2)
    expect(shown(alice2).message).toBe('newest')
  })
})
