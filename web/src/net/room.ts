/**
 * The shared record of ONE online game, and the host's rules for changing it.
 *
 * GameHub relays; it never interprets state (`docs/PATTERNS.md` §1). One client —
 * the room's **host** — owns the authoritative {@link RoomWorld} and publishes it
 * with `setState`; everyone else mirrors it and sends INTENTS to the host. Every
 * client holds the whole world, so when the host leaves GameHub promotes another
 * player and that player simply continues from its copy (§5).
 *
 * Everything here is PURE — no socket, no timer — so the rules a game depends on
 * ("only the acting seat may move", "a move built on an old state is refused",
 * "a lobby holds at most `maxPlayers`") are pinned without a network
 * (`room.test.ts`). `session.ts` is the only caller that talks to the hub.
 *
 * ## Seats are tokens, not connections
 *
 * A GameHub player id lives as long as one WebSocket. A seat is bound to the
 * player's stable `token` (`identity.ts`), and each member records the
 * connection it is on right now (`conn`, or `null` while away). A `commit` is
 * accepted only from the connection the token is currently on.
 */

import type { SavedGameBlob } from '../persistence/saveGame'
import { NetError } from './failure'
import { cleanName, isLegalToken } from './identity'
import { actingPlayerIds } from './sync'

/** Bumped when the world's shape changes; a room with another version is not joined. */
export const PROTOCOL_VERSION = 1
export const ROOM_KIND = 'colossus'

export interface Member {
  readonly token: string
  readonly name: string
  /** The GameHub connection this member is on now, or `null` while away. */
  readonly conn: number | null
}

export interface RoomWorld {
  readonly v: typeof PROTOCOL_VERSION
  readonly kind: typeof ROOM_KIND
  /** Stable across re-opened rooms; a room CODE is not (it dies with the room). */
  readonly gameId: string
  readonly displayName: string
  readonly variant: string
  readonly maxPlayers: number
  readonly status: 'lobby' | 'started'
  readonly creatorToken: string
  /** Everyone who joined, in join order (creator first). Spectators included. */
  readonly members: readonly Member[]
  /** Tokens in seat order, fixed at Start. Empty in the lobby. */
  readonly seats: readonly string[]
  /** Increments on every accepted change of `game`; a move names the rev it was built on. */
  readonly rev: number
  /** The token whose move produced `rev` (`null` for Start or a lobby change). */
  readonly lastBy: string | null
  /** The game, in the ONE save format (`serializeGame`). `null` in the lobby. */
  readonly game: SavedGameBlob | null
  /** The cued room (`raum`) this game was created for, so invitees find it (`cued.ts`). */
  readonly cuedRaum?: string | null
}

/** What the lobby list shows, carried in the GameHub room `meta`. */
export interface RoomMeta {
  readonly kind: typeof ROOM_KIND
  readonly v: typeof PROTOCOL_VERSION
  readonly gameId: string
  readonly variant: string
  readonly status: RoomWorld['status']
  readonly maxPlayers: number
  readonly members: number
  /** See {@link RoomWorld.cuedRaum}. */
  readonly cuedRaum: string | null
}

/** Player → host. */
export type Intent =
  | { t: 'hello'; token: string; name: string; heldRev: number | null; gameId: string | null }
  | { t: 'leave'; token: string }
  | { t: 'commit'; token: string; base: number; game: SavedGameBlob }
  | { t: 'backup'; world: RoomWorld }
  /** Host → one player. */
  | { t: 'rejected'; code: string; message: string; rev: number }
  | { t: 'send-backup' }

export function newGameId(): string {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return 'g_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function createWorld(options: {
  gameId?: string
  displayName: string
  variant: string
  maxPlayers: number
  creator: { token: string; name: string }
  conn: number | null
  cuedRaum?: string | null
}): RoomWorld {
  return {
    v: PROTOCOL_VERSION,
    kind: ROOM_KIND,
    gameId: options.gameId ?? newGameId(),
    displayName: cleanName(options.displayName) || 'Colossus game',
    variant: options.variant,
    maxPlayers: options.maxPlayers,
    status: 'lobby',
    creatorToken: options.creator.token,
    members: [{ token: options.creator.token, name: cleanName(options.creator.name), conn: options.conn }],
    seats: [],
    rev: 0,
    lastBy: null,
    game: null,
    cuedRaum: options.cuedRaum ?? null,
  }
}

export function roomMeta(world: RoomWorld): RoomMeta {
  return {
    kind: ROOM_KIND,
    v: PROTOCOL_VERSION,
    gameId: world.gameId,
    variant: world.variant,
    status: world.status,
    maxPlayers: world.maxPlayers,
    members: world.status === 'started' ? world.seats.length : world.members.length,
    cuedRaum: world.cuedRaum ?? null,
  }
}

/** A room's meta, if it is a Colossus room of THIS protocol; anything else is not ours. */
export function parseRoomMeta(meta: unknown): RoomMeta | null {
  if (typeof meta !== 'object' || meta === null) return null
  const m = meta as Partial<RoomMeta>
  if (m.kind !== ROOM_KIND || m.v !== PROTOCOL_VERSION) return null
  if (typeof m.gameId !== 'string' || typeof m.variant !== 'string') return null
  if (m.status !== 'lobby' && m.status !== 'started') return null
  if (typeof m.maxPlayers !== 'number' || typeof m.members !== 'number') return null
  return { ...(m as RoomMeta), cuedRaum: typeof m.cuedRaum === 'string' && m.cuedRaum.length > 0 ? m.cuedRaum : null }
}

/** This token's seat index, or -1 (spectator, or not in the game). */
export function seatOf(world: RoomWorld, token: string): number {
  return world.seats.indexOf(token)
}

export function memberOf(world: RoomWorld, token: string): Member | null {
  return world.members.find((m) => m.token === token) ?? null
}

/**
 * Validate a world received from the wire or from local storage. A world that
 * does not parse is a LOUD `bad_world` — never an empty game.
 */
export function parseWorld(value: unknown): RoomWorld {
  const fail = (why: string): never => {
    throw new NetError('bad_world', `the game record is malformed: ${why}`)
  }
  if (typeof value !== 'object' || value === null) return fail('not an object')
  const w = value as Partial<RoomWorld>
  if (w.kind !== ROOM_KIND) return fail('not a Colossus game')
  if (w.v !== PROTOCOL_VERSION) {
    throw new NetError(
      'unsupported_version',
      `this game uses protocol ${String(w.v)}; this client speaks ${PROTOCOL_VERSION} — reload to update`,
    )
  }
  if (typeof w.gameId !== 'string' || w.gameId.length === 0) fail('gameId')
  if (typeof w.displayName !== 'string') fail('displayName')
  if (typeof w.variant !== 'string') fail('variant')
  if (typeof w.maxPlayers !== 'number' || w.maxPlayers < 2) fail('maxPlayers')
  if (w.status !== 'lobby' && w.status !== 'started') fail('status')
  if (!isLegalToken(w.creatorToken)) fail('creatorToken')
  if (!Array.isArray(w.members)) fail('members')
  for (const m of w.members!) {
    if (!isLegalToken(m?.token) || typeof m.name !== 'string') fail('member')
    if (m.conn !== null && typeof m.conn !== 'number') fail('member conn')
  }
  if (!Array.isArray(w.seats) || !w.seats.every(isLegalToken)) fail('seats')
  if (typeof w.rev !== 'number' || !Number.isInteger(w.rev) || w.rev < 0) fail('rev')
  if (w.lastBy !== null && !isLegalToken(w.lastBy)) fail('lastBy')
  if (w.cuedRaum !== undefined && w.cuedRaum !== null && typeof w.cuedRaum !== 'string') fail('cuedRaum')
  if (w.status === 'started') {
    if (w.seats!.length < 2) fail('a started game needs at least 2 seats')
    if (w.game === null || typeof w.game !== 'object') fail('a started game needs its state')
  } else if (w.seats!.length !== 0 || w.game !== null) {
    fail('a lobby has no seats and no state yet')
  }
  if (w.game !== null) assertGameBlob(w.game, w.variant!)
  return w as RoomWorld
}

function assertGameBlob(game: unknown, variant: string): asserts game is SavedGameBlob {
  const g = game as Partial<SavedGameBlob> | null
  if (typeof g !== 'object' || g === null || typeof g.state !== 'object' || g.state === null) {
    throw new NetError('bad_world', 'the game state is malformed')
  }
  if (g.variantName !== variant) {
    throw new NetError('bad_world', `the game state is ${String(g.variantName)}, the room is ${variant}`)
  }
  if (!Array.isArray(g.state.players)) throw new NetError('bad_world', 'the game state has no players')
}

// ---------------------------------------------------------------------------
// The host's rules
// ---------------------------------------------------------------------------

export interface HostOutcome {
  /** The world after the intent; the same object when nothing changed. */
  readonly world: RoomWorld
  /** A message for the sender only (a refusal, or a request for its backup). */
  readonly reply: Intent | null
}

const unchanged = (world: RoomWorld, reply: Intent | null = null): HostOutcome => ({ world, reply })
const reject = (world: RoomWorld, code: string, message: string): HostOutcome =>
  unchanged(world, { t: 'rejected', code, message, rev: world.rev })

/**
 * Apply ONE intent from connection `from` to the host's world. Pure: the caller
 * publishes `world` when it changed and sends `reply` to `from`.
 */
export function hostHandle(world: RoomWorld, intent: Intent, from: number): HostOutcome {
  switch (intent.t) {
    case 'hello':
      return hostHello(world, intent, from)
    case 'leave': {
      if (world.status !== 'lobby') return unchanged(world)
      const member = memberOf(world, intent.token)
      if (member === null || member.conn !== from || intent.token === world.creatorToken) {
        return unchanged(world)
      }
      return unchanged({ ...world, members: world.members.filter((m) => m.token !== intent.token) })
    }
    case 'commit':
      return hostCommit(world, intent, from)
    case 'backup': {
      // A seated player's copy is NEWER than ours (the room was re-opened from an
      // older copy): take it, keeping who is connected right now.
      let backup: RoomWorld
      try {
        backup = parseWorld(intent.world)
      } catch {
        return unchanged(world)
      }
      if (backup.gameId !== world.gameId || backup.rev <= world.rev) return unchanged(world)
      const conns = new Map(world.members.map((m) => [m.token, m.conn]))
      const members = backup.members.map((m) => ({ ...m, conn: conns.get(m.token) ?? null }))
      for (const m of world.members) if (!members.some((x) => x.token === m.token)) members.push(m)
      return unchanged({ ...backup, members })
    }
    default:
      return unchanged(world)
  }
}

function hostHello(
  world: RoomWorld,
  intent: Extract<Intent, { t: 'hello' }>,
  from: number,
): HostOutcome {
  if (!isLegalToken(intent.token)) return reject(world, 'bad_message', 'hello without a legal token')
  const name = cleanName(intent.name) || 'Player'
  const existing = memberOf(world, intent.token)
  // A connection that moved to another token (or a stale entry for this conn) is released.
  let members = world.members.map((m) =>
    m.conn === from && m.token !== intent.token ? { ...m, conn: null } : m,
  )
  if (existing !== null) {
    members = members.map((m) => (m.token === intent.token ? { ...m, name, conn: from } : m))
  } else {
    if (world.status === 'lobby' && world.members.length >= world.maxPlayers) {
      return reject(world, 'game_full', `"${world.displayName}" already has ${world.maxPlayers} players`)
    }
    members = [...members, { token: intent.token, name, conn: from }]
  }
  const next = { ...world, members }
  const newer =
    seatOf(world, intent.token) >= 0 &&
    intent.gameId === world.gameId &&
    intent.heldRev !== null &&
    intent.heldRev > world.rev
  return unchanged(next, newer ? { t: 'send-backup' } : null)
}

function hostCommit(
  world: RoomWorld,
  intent: Extract<Intent, { t: 'commit' }>,
  from: number,
): HostOutcome {
  if (world.status !== 'started' || world.game === null) {
    return reject(world, 'not_started', 'the game has not started')
  }
  const member = memberOf(world, intent.token)
  const seat = seatOf(world, intent.token)
  if (member === null || member.conn !== from || seat < 0) {
    return reject(world, 'not_seated', 'only a seated player may move')
  }
  if (intent.base !== world.rev) {
    return reject(
      world,
      'stale_move',
      `the move was built on state ${intent.base}, the game is at ${world.rev} — showing the current state`,
    )
  }
  const playerId = world.game.state.players[seat]?.id
  if (playerId === undefined || !actingPlayerIds(world.game.state).includes(playerId)) {
    return reject(world, 'not_your_turn', 'it is not your turn')
  }
  try {
    assertGameBlob(intent.game, world.variant)
  } catch (error) {
    return reject(world, 'bad_world', error instanceof Error ? error.message : String(error))
  }
  return unchanged({ ...world, rev: world.rev + 1, lastBy: intent.token, game: intent.game })
}

/** A connection left: its member is away (seats are kept — they come back). */
export function hostDisconnect(world: RoomWorld, conn: number): RoomWorld {
  if (!world.members.some((m) => m.conn === conn)) return world
  return { ...world, members: world.members.map((m) => (m.conn === conn ? { ...m, conn: null } : m)) }
}

/**
 * Bring the world in line with who is ACTUALLY in the room — run by a host that
 * just took over, since the previous host's view of `conn` may be stale.
 */
export function hostReconcile(world: RoomWorld, present: ReadonlySet<number>): RoomWorld {
  if (world.members.every((m) => m.conn === null || present.has(m.conn))) return world
  return {
    ...world,
    members: world.members.map((m) => (m.conn !== null && !present.has(m.conn) ? { ...m, conn: null } : m)),
  }
}

/** Why Start is refused, or null. The ONE rule, used by the button and the action. */
export function startRefusal(world: RoomWorld): NetError | null {
  if (world.status !== 'lobby') return new NetError('already_started', 'the game has already started')
  if (world.members.length < 2) {
    return new NetError('not_enough_players', 'a game needs at least 2 players — wait for someone to join')
  }
  return null
}

/** Start: seats are the members in join order (creator first), and `game` is the opening state. */
export function startWorld(world: RoomWorld, game: SavedGameBlob): RoomWorld {
  const refusal = startRefusal(world)
  if (refusal) throw refusal
  return {
    ...world,
    status: 'started',
    seats: world.members.slice(0, world.maxPlayers).map((m) => m.token),
    rev: world.rev + 1,
    lastBy: null,
    game,
  }
}
