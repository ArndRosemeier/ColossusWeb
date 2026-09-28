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
 * a one-shot read; the LIVE lobby is `net/lobbyWatcher.ts`, which drives these
 * operations from the ONE poll loop. Bodies are read by NAME and only when the
 * listing's `sha256` changed (`contentCache.ts`), so a live lobby does not
 * re-read what it already holds.
 */

import type { ContentCache } from './contentCache'
import { describeFailure, type FailureDescription } from './failure'
import {
  GAME_RECORD_VERSION,
  MIN_SEATS,
  PLAYER_OBJECT_PREFIX,
  PLAYER_RECORD_VERSION,
  assertGameId,
  assertGameObjectName,
  assertPlayerObjectName,
  gameIdFor,
  gameObjectsPrefix,
  parseGameObjectName,
  parseGameObjectRecord,
  parsePlayerObjectName,
  parsePlayerRecord,
  playerObjectsPrefixFor,
  playerTagFor,
  seatOrderFor,
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
 * two players. The NUMBER lives in `gameRecord.ts` as {@link MIN_SEATS} so the
 * strict record parser and the lobby rule cannot drift apart; this name is kept
 * because it is what the lobby's own callers and tests read.
 */
export const MIN_PLAYERS_TO_START = MIN_SEATS

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

/**
 * How many participants a listing holds.
 *
 * Since S5 the listing a caller passes here is ALREADY scoped by
 * `player.<gameid>.` — one game's participants and nothing else — so this is
 * just its length. It is still a named function so the count has ONE
 * definition and cannot drift between the three call sites that ask for it.
 */
function countPlayers(playerObjects: readonly StoreObject[]): number {
  return playerObjects.length
}

/**
 * Read every joined player's record for a game, from the `player.<gameid>.`
 * listing the caller has ALREADY taken. This is the ONE place player bodies are
 * read, so `readLobby` (what the UI shows) and `startGame` (which must derive
 * the seat order from exactly these records) can never disagree about who is in
 * the game.
 *
 * The listing is taken by NAME through the body cache, and only when the
 * listing's `sha256` says a body changed ({@link ContentCache}); a body the
 * caller already holds is never re-read.
 */
async function readPlayerRecords(
  ctx: LobbyContext,
  playerObjects: readonly StoreObject[],
  cache?: ContentCache,
): Promise<PlayerRecord[]> {
  const players: PlayerRecord[] = []
  for (const object of playerObjects) {
    const value = cache
      ? await cache.adopt(object.name, object.sha256)
      : (await ctx.transport.get(ctx.store, object.name)).value
    players.push(parsePlayerRecord(value))
  }
  return players
}

/**
 * Read ONE game record by NAME and check that the body and the name agree
 * (`parseGameObjectRecord`). A point read is as narrow as a `prefix=game.` list
 * and costs the same single request; it is used where the game's own listing is
 * not already in hand (there the listing's `sha256` is used instead, so no read
 * is repeated). The name is asserted first, so an illegal game id fails locally.
 */
async function readGameRecord(
  ctx: LobbyContext,
  gameId: string,
  cache?: ContentCache,
): Promise<GameRecord> {
  const gameName = assertGameObjectName(gameId)
  const result = await ctx.transport.get(ctx.store, gameName)
  if (cache !== undefined && result.sha256 !== null) {
    // The caller holds these bytes now, so a later tick whose listing still
    // reports this hash can skip the read.
    cache.put(gameName, result.sha256, result.value)
  }
  return parseGameObjectRecord(gameName, result.value)
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
    // No seats before Start: the seat order is derived from who has JOINED, and
    // at Create that is nobody. `startGame` writes it.
    seatOrder: [],
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
 * List the games in the store, with ONE narrow request: `prefix=game.` returns
 * exactly the lobby's records — no snapshots, no player objects, nothing else.
 * That is the whole point of the S5 rename: before it the leading segment was
 * the game id, so every prefix (`g.`) returned the WHOLE store, and snapshots
 * (one object per move) dominate it as a game runs.
 *
 * **The listing is for LEARNING NAMES, never for reading content.** Bodies are
 * read by name through the content cache, and only when their `sha256` changed,
 * so the steady state of a poll tick is one list request and no body reads. The
 * prefix shrinks the LIST; the cache shrinks the READS.
 *
 * A caller that already has the games listing (and the player objects it wants
 * counted) can pass them in (see {@link listGamesFrom}), so a tick takes each
 * request exactly once.
 */
export async function listGames(
  ctx: LobbyContext,
  cache?: ContentCache,
): Promise<GameListing> {
  const [games, players] = await Promise.all([
    ctx.transport.list(ctx.store, gameObjectsPrefix()),
    // The `player.` prefix matches EVERY game's participants — this is the one
    // place the wide player listing is right, because the lobby must show each
    // listed game's player count. The per-game view uses
    // `playerObjectsPrefixFor(gameId)` instead.
    ctx.transport.list(ctx.store, PLAYER_OBJECT_PREFIX),
  ])
  return listGamesFrom(ctx, games, players, cache)
}

/**
 * Discovery from listings the caller already took: the games
 * (`prefix=game.`) and the player objects it wants counted. The cache is brought
 * in line with the GAMES listing, which is what drops a name that has
 * disappeared: a deleted game is not remembered as current.
 */
export async function listGamesFrom(
  ctx: LobbyContext,
  objects: readonly StoreObject[],
  playerObjects: readonly StoreObject[] = [],
  cache?: ContentCache,
): Promise<GameListing> {
  cache?.retain(objects.map((object) => object.name))
  const tag = playerTagFor(ctx.identity.id)
  const games: ListedGame[] = []
  const unreadable: UnreadableGame[] = []

  for (const object of objects) {
    const gameId = parseGameObjectName(object.name)
    // "not a game": not a lobby object at all, so it is in neither list. The
    // old scheme (`g.<id>.game`, pre-S5) lands here too, which is exactly how an
    // orphaned `g.*` object is ignored without being deleted.
    if (gameId === null) continue
    try {
      const value = cache
        ? await cache.adopt(object.name, object.sha256)
        : (await ctx.transport.get(ctx.store, object.name)).value
      const record = parseGameObjectRecord(object.name, value)
      const mine = playerObjects.filter(
        (player) => parsePlayerObjectName(player.name)?.gameId === gameId,
      )
      games.push({
        objectName: object.name,
        gameId,
        record,
        playerCount: countPlayers(mine),
        alreadyJoined: mine.some((player) => parsePlayerObjectName(player.name)?.tag === tag),
      })
    } catch (error) {
      // LOUD: a game we cannot read is reported with the service's own code and
      // message, not skipped — the lobby stays usable for every OTHER game.
      unreadable.push({ objectName: object.name, gameId, failure: describeFailure(error) })
    }
  }
  return { games, unreadable }
}

/**
 * Read one game and everyone in it. The caller's own action, so failures
 * propagate. TWO narrow reads, never the whole store:
 *
 *  - the game record, from the `prefix=game.` listing when the caller already
 *    holds one (`games`), else by NAME — one request either way;
 *  - its participants with `prefix=player.<gameid>.` — exactly this game's
 *    players, unless the caller already listed them (`players`).
 *
 * A game whose object is not in the listing it was given is a LOUD `not_found`:
 * a game view must not render a record it cannot point at.
 */
export async function readLobby(
  ctx: LobbyContext,
  gameId: string,
  options: {
    games?: readonly StoreObject[]
    players?: readonly StoreObject[]
    cache?: ContentCache
  } = {},
): Promise<ActiveLobby> {
  assertGameId(gameId)
  const gameName = assertGameObjectName(gameId)
  const subject = options.games?.find((object) => object.name === gameName)
  let record: GameRecord
  if (subject !== undefined) {
    const value = options.cache
      ? await options.cache.adopt(subject.name, subject.sha256)
      : (await ctx.transport.get(ctx.store, gameName)).value
    record = parseGameObjectRecord(gameName, value)
  } else if (options.games !== undefined) {
    throw new ServerStoreError(
      'not_found',
      `no object ${JSON.stringify(gameName)} in store ${JSON.stringify(ctx.store)}`,
      404,
    )
  } else {
    record = await readGameRecord(ctx, gameId, options.cache)
  }
  const playerObjects =
    options.players ?? (await ctx.transport.list(ctx.store, playerObjectsPrefixFor(gameId)))
  return { record, players: await readPlayerRecords(ctx, playerObjects, options.cache) }
}

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

/**
 * Join a game: write the caller's OWN `player.<gameid>.<tag>` object and nothing
 * else. Joining again returns the object already there, unchanged.
 *
 * The listing it needs is ONE narrow request, `prefix=player.<gameid>.` — this
 * game's participants — because both questions it asks ("is my object already
 * there?", "is the game full?") are about exactly those objects.
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
  const players = await ctx.transport.list(ctx.store, playerObjectsPrefixFor(gameId))

  const mine = players.find((object) => object.name === playerName)
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

  const blocked = joinBlockedReason(record, countPlayers(players))
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
 * Start a game: flip `status` to `'started'` AND write the explicit seat order,
 * in the SAME object, exactly once. Only the creator's client may do it, and a
 * refusal writes nothing.
 *
 * The seat order is derived from the player records that are actually in the
 * store at this moment ({@link seatOrderFor}: creator first, everyone else by
 * tag). Deriving it here — rather than at each client — is what makes every
 * client agree on which `GameState.players` index is whose, with no extra
 * round trip and no second source of truth.
 */
export async function startGame(
  ctx: LobbyContext,
  gameId: string,
  cache?: ContentCache,
): Promise<GameRecord> {
  assertGameId(gameId)
  const gameName = assertGameObjectName(gameId)
  // TWO narrow listings: the games (`prefix=game.`, whose `sha256` lets the
  // record be read through the cache) and this game's participants
  // (`prefix=player.<gameid>.`) — exactly the records the seat order is derived
  // from. Never the whole store.
  const games = await ctx.transport.list(ctx.store, gameObjectsPrefix())
  const playerObjects = await ctx.transport.list(ctx.store, playerObjectsPrefixFor(gameId))
  const { record } = await readLobby(ctx, gameId, { games, players: playerObjects, cache })
  const players = await readPlayerRecords(ctx, playerObjects, cache)
  const refusal = startRefusal(record, ctx.identity, players.length)
  if (refusal) throw refusal

  const started: GameRecord = {
    ...record,
    status: 'started',
    seatOrder: seatOrderFor(record.creator.id, players),
  }
  await ctx.transport.put(ctx.store, gameName, serializeGameRecord(started))
  // The caller's cached copy of THIS object is now older than the store. Its
  // content address changed, so the next listing would miss anyway; forgetting it
  // here also drops it for a caller that reads without re-listing.
  cache?.forget(gameName)
  return started
}
