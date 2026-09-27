/**
 * The lobby operations — Create, Join, Start — over S1's transport.
 *
 * This module is the WHOLE lobby lifecycle: it writes `g.<gameid>.game` (creator
 * only), `g.<gameid>.p.<tag>` (each player their own), and it enforces the rules
 * BEFORE any write. It imports no `fetch` and no React: it takes a
 * {@link ServerStoreTransport} and the caller's identity, so the in-memory twin
 * and the stubbed HTTP client are equally drivable (`docs/design/multiplayer.md`
 * §4.2; `tools/`-free by construction).
 *
 * ## The rules, and where they are enforced
 *
 * | Rule | Enforced by | On refusal |
 * | --- | --- | --- |
 * | Start is the creator's alone | {@link startRefusal} | throws `not_creator`, writes NOTHING |
 * | A game starts once | {@link startRefusal} | throws `already_started` |
 * | A started game takes no joins | {@link joinBlockedReason} | throws `game_started`, writes NOTHING |
 * | A full game takes no joins | {@link joinBlockedReason} | throws `game_full`, writes NOTHING |
 * | Joining twice is idempotent | {@link joinGame} | returns the existing record, writes NOTHING |
 * | Two players never share a name | {@link joinGame} | throws `player_tag_collision` |
 *
 * Every refusal is a thrown {@link ServerStoreError} carrying a `code` and a
 * human `message`, which is the app's ONE error surface (`failure.ts`): a refusal
 * is never a silent no-op (`AGENTS.md` rule 1).
 *
 * ## What this slice deliberately does NOT do
 *
 * No polling, no snapshots, no turn authority — that is S3. {@link listGames} is
 * a one-shot read, refreshed by the UI on an action or an explicit Refresh; the
 * lobby never watches the store in the background.
 */

import { describeFailure, type FailureDescription } from './failure'
import {
  GAME_RECORD_VERSION,
  PLAYER_RECORD_VERSION,
  assertGameId,
  assertGameObjectName,
  assertPlayerObjectName,
  gameIdFor,
  parseGameObjectRecord,
  parseGameObjectName,
  parsePlayerObjectName,
  parsePlayerRecord,
  playerTagFor,
  serializeGameRecord,
  serializePlayerRecord,
  type GameRecord,
  type PlayerRecord,
} from './gameRecord'
import { serverStoreName } from './storeName'
import {
  ServerStoreError,
  assertStoreName,
  type ServerStoreTransport,
  type StoreIdentity,
  type StoreObject,
} from './transport'

/**
 * At least two seats, because the hand-off (`createGame` in the engine) requires
 * two players. Enforcing it HERE turns a crash in the game flow into a lobby
 * refusal; it is a decision taken in this slice, not one the brief spelled out.
 */
export const MIN_PLAYERS_TO_START = 2

export interface LobbyContext {
  readonly transport: ServerStoreTransport
  /** The caller's `whoami()` identity. The FULL id is used for every comparison. */
  readonly identity: StoreIdentity
  /** The store the game objects live in. Comes from `storeName.ts`, never a literal. */
  readonly store: string
}

/**
 * Build the context every operation takes. The store name defaults to
 * {@link serverStoreName} and is validated here, once, so an illegal env override
 * fails at construction rather than mid-write.
 */
export function lobbyContext(options: {
  transport: ServerStoreTransport
  identity: StoreIdentity
  store?: string
}): LobbyContext {
  const store = options.store ?? serverStoreName()
  assertStoreName(store)
  return { transport: options.transport, identity: options.identity, store }
}

export interface CreateGameRequest {
  /** Anything the creator typed. The object name is a slug of this. */
  displayName: string
  variant: string
  maxPlayers: number
}

/** A game discovery found and could read. */
export interface ListedGame {
  readonly objectName: string
  readonly gameId: string
  readonly record: GameRecord
  /** How many `p.` objects the store currently holds for this game. */
  readonly playerCount: number
  /**
   * The caller's own tag is present. A HINT for the UI; {@link joinGame} makes
   * the authoritative decision from the full id inside the player body.
   */
  readonly alreadyJoined: boolean
}

/** A game-looking object whose body could not be read. Surfaced, never dropped. */
export interface UnreadableGame {
  readonly objectName: string
  readonly gameId: string
  readonly failure: FailureDescription
}

/**
 * The result of discovery. The two lists are the answer to "how does a caller
 * distinguish 'not a game' from 'a game I cannot read'?":
 *
 *  - a name that does not match the game shape is in NEITHER list ("not a game");
 *  - a game whose body is missing, refused or malformed is in `unreadable` with
 *    the service's own code and message (never silently dropped).
 */
export interface GameListing {
  readonly games: ListedGame[]
  readonly unreadable: UnreadableGame[]
}

/** A game the caller is currently inside: its record plus everyone who joined. */
export interface ActiveLobby {
  readonly record: GameRecord
  readonly players: PlayerRecord[]
}

// ---------------------------------------------------------------------------
// The rules, as pure predicates (the UI and the operations share ONE copy)
// ---------------------------------------------------------------------------

/**
 * Why this caller may not JOIN this game — `null` when they may. Idempotency is
 * deliberately NOT here: being already in is a successful no-op, not a refusal.
 */
export function joinBlockedReason(record: GameRecord, playerCount: number): ServerStoreError | null {
  if (record.status !== 'lobby') {
    return new ServerStoreError(
      'game_started',
      `"${record.displayName}" has already started and takes no new players`,
    )
  }
  if (playerCount >= record.maxPlayers) {
    return new ServerStoreError(
      'game_full',
      `"${record.displayName}" is full (${record.maxPlayers} players)`,
    )
  }
  return null
}

/** Why this caller may not START this game — `null` when they may. */
export function startRefusal(
  record: GameRecord,
  identity: StoreIdentity,
  playerCount: number,
): ServerStoreError | null {
  if (record.creator.id !== identity.id) {
    return new ServerStoreError(
      'not_creator',
      `only the creator (${record.creator.label}) may start "${record.displayName}"`,
    )
  }
  if (record.status === 'started') {
    return new ServerStoreError('already_started', `"${record.displayName}" has already started`)
  }
  if (playerCount < MIN_PLAYERS_TO_START) {
    return new ServerStoreError(
      'not_enough_players',
      `"${record.displayName}" needs at least ${MIN_PLAYERS_TO_START} players to start; ${playerCount} joined`,
    )
  }
  return null
}

function countPlayers(objects: readonly StoreObject[], gameId: string): number {
  let count = 0
  for (const object of objects) {
    if (parsePlayerObjectName(object.name)?.gameId === gameId) count += 1
  }
  return count
}

/** The player objects the store holds for one game, in the store's own order. */
function playerObjectsFor(objects: readonly StoreObject[], gameId: string): StoreObject[] {
  return objects.filter((object) => parsePlayerObjectName(object.name)?.gameId === gameId)
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a game: write EXACTLY one object, `g.<gameid>.game`, in `status:'lobby'`.
 *
 * The creator's own `p.` object is NOT written here — a join is its own action
 * (the UI performs it straight after Create so the creator is a player too), and
 * keeping create a single write is what makes "exactly one object" checkable.
 */
export async function createGame(
  ctx: LobbyContext,
  request: CreateGameRequest,
): Promise<GameRecord> {
  const displayName = request.displayName.trim()
  if (displayName.length === 0) {
    throw new ServerStoreError('no_display_name', 'a multiplayer game needs a display name')
  }
  const variant = request.variant.trim()
  if (variant.length === 0) {
    throw new ServerStoreError('no_variant', 'a multiplayer game needs a variant name')
  }
  if (!Number.isInteger(request.maxPlayers) || request.maxPlayers < 2) {
    throw new ServerStoreError(
      'invalid_max_players',
      `maxPlayers must be an integer of 2 or more, got ${JSON.stringify(request.maxPlayers)}`,
    )
  }

  const gameId = gameIdFor(displayName)
  const record: GameRecord = {
    version: GAME_RECORD_VERSION,
    gameId,
    displayName,
    variant,
    creator: { id: ctx.identity.id, label: ctx.identity.label },
    status: 'lobby',
    maxPlayers: request.maxPlayers,
    createdAt: new Date().toISOString(),
  }
  await ctx.transport.put(
    ctx.store,
    assertGameObjectName(gameId),
    serializeGameRecord(record),
  )
  return record
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * List the games in the store: the store's own list route, filtered client-side
 * to the game-object shape. One `GET` per game object; no polling, no query API
 * (the service has none — `docs/design/multiplayer.md` §4.2).
 */
export async function listGames(ctx: LobbyContext): Promise<GameListing> {
  const objects = await ctx.transport.list(ctx.store)
  const tag = playerTagFor(ctx.identity.id)
  const games: ListedGame[] = []
  const unreadable: UnreadableGame[] = []

  for (const object of objects) {
    const gameId = parseGameObjectName(object.name)
    // "not a game": not a lobby object at all, so it is in neither list.
    if (gameId === null) continue
    try {
      const value = (await ctx.transport.get(ctx.store, object.name)).value
      games.push({
        objectName: object.name,
        gameId,
        record: parseGameObjectRecord(object.name, value),
        playerCount: countPlayers(objects, gameId),
        alreadyJoined: playerObjectsFor(objects, gameId).some(
          (player) => parsePlayerObjectName(player.name)?.tag === tag,
        ),
      })
    } catch (error) {
      // LOUD: a game we cannot read is reported with the service's own code and
      // message, not skipped — the lobby stays usable for every OTHER game.
      unreadable.push({ objectName: object.name, gameId, failure: describeFailure(error) })
    }
  }
  return { games, unreadable }
}

/** Read one game and everyone in it. The caller's own action, so failures propagate. */
export async function readLobby(ctx: LobbyContext, gameId: string): Promise<ActiveLobby> {
  assertGameId(gameId)
  const gameName = assertGameObjectName(gameId)
  const record = parseGameObjectRecord(
    gameName,
    (await ctx.transport.get(ctx.store, gameName)).value,
  )
  const players: PlayerRecord[] = []
  for (const object of playerObjectsFor(await ctx.transport.list(ctx.store), gameId)) {
    players.push(parsePlayerRecord((await ctx.transport.get(ctx.store, object.name)).value))
  }
  return { record, players }
}

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

/**
 * Join a game: write the caller's OWN `g.<gameid>.p.<tag>` object and nothing
 * else. Joining again returns the object already there, unchanged.
 */
export async function joinGame(ctx: LobbyContext, gameId: string): Promise<PlayerRecord> {
  assertGameId(gameId)
  const gameName = assertGameObjectName(gameId)
  const tag = playerTagFor(ctx.identity.id)
  const playerName = assertPlayerObjectName(gameId, tag)

  const record = parseGameObjectRecord(
    gameName,
    (await ctx.transport.get(ctx.store, gameName)).value,
  )
  const objects = await ctx.transport.list(ctx.store)

  const mine = objects.find((object) => object.name === playerName)
  if (mine) {
    const existing = parsePlayerRecord(
      (await ctx.transport.get(ctx.store, playerName)).value,
    )
    // The name carries only the first 8 characters of the id. If a DIFFERENT
    // full id hashes to this name, refuse rather than overwrite another player.
    if (existing.playerId !== ctx.identity.id) {
      throw new ServerStoreError(
        'player_tag_collision',
        `${playerName} belongs to another player (id ${JSON.stringify(existing.playerId)}); this client's id is ${JSON.stringify(ctx.identity.id)}`,
      )
    }
    return existing
  }

  const blocked = joinBlockedReason(record, countPlayers(objects, gameId))
  if (blocked) throw blocked

  const player: PlayerRecord = {
    version: PLAYER_RECORD_VERSION,
    gameId,
    playerId: ctx.identity.id,
    label: ctx.identity.label,
    joinedAt: new Date().toISOString(),
  }
  await ctx.transport.put(ctx.store, playerName, serializePlayerRecord(player))
  return player
}

/** Leave a game: remove the caller's own object and nothing else. */
export async function leaveGame(ctx: LobbyContext, gameId: string): Promise<void> {
  assertGameId(gameId)
  const tag = playerTagFor(ctx.identity.id)
  const playerName = assertPlayerObjectName(gameId, tag)
  let existing: PlayerRecord | null = null
  try {
    existing = parsePlayerRecord((await ctx.transport.get(ctx.store, playerName)).value)
  } catch (error) {
    // Already out reaches the same end state as leaving did; anything else is loud.
    if (error instanceof ServerStoreError && error.code === 'not_found') return
    throw error
  }
  if (existing.playerId !== ctx.identity.id) {
    throw new ServerStoreError(
      'player_tag_collision',
      `${playerName} belongs to another player (id ${JSON.stringify(existing.playerId)}); refusing to remove it`,
    )
  }
  await ctx.transport.remove(ctx.store, playerName)
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/**
 * Start a game: flip `status` to `'started'` in the SAME object, exactly once.
 * Only the creator's client may do it, and a refusal writes nothing.
 */
export async function startGame(ctx: LobbyContext, gameId: string): Promise<GameRecord> {
  assertGameId(gameId)
  const gameName = assertGameObjectName(gameId)
  const record = parseGameObjectRecord(
    gameName,
    (await ctx.transport.get(ctx.store, gameName)).value,
  )
  const refusal = startRefusal(record, ctx.identity, countPlayers(await ctx.transport.list(ctx.store), gameId))
  if (refusal) throw refusal

  const started: GameRecord = { ...record, status: 'started' }
  await ctx.transport.put(ctx.store, gameName, serializeGameRecord(started))
  return started
}
