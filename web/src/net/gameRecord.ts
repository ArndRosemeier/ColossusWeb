/**
 * The lobby's plain-data records — the shape of a game object
 * (`g.<gameid>.game`) and of a player object (`g.<gameid>.p.<tag>`), the ONLY
 * place those names are built and parsed, and the parse/validate boundary for
 * both bodies.
 *
 * The design is `docs/design/multiplayer.md` §4.2. Two rules are structural here:
 *
 *  1. **Exactly one writer per object.** The game object is written only by the
 *     creator (at Create, then at Start); a player object is written only by its
 *     owner when they join. Nothing in this module reads or writes anything —
 *     it is pure data plus naming, so it stays usable from the lobby operations,
 *     the UI and a test alike.
 *  2. **A body that does not parse is LOUD** (`AGENTS.md` rule 1). A caller that
 *     is DISCOVERING games (`listGames`) turns that error into an explicit
 *     "unreadable" entry; a caller that is joining or starting a NAMED game lets
 *     it propagate, because there the record is the thing being acted on.
 *
 * ## The name budget (why the shapes are capped)
 *
 * The service's object-name rule is `[a-z0-9][a-z0-9._-]{0,63}` — 1–64 chars
 * (`transport.ts`). A player object name is longer than a game object name, so
 * the budget is spent on the player object:
 *
 *     g. <gameid<=32> . p . <tag8>   <= 45 characters
 *
 * `MAX_GAME_ID_LENGTH = 32` is therefore a deliberate cap: a 23-character slug
 * plus `-` plus an 8-hex suffix. The *display* name is not capped and lives in
 * the body, so a very long — or entirely unpunctuatable — name is truncated to
 * the slug and still yields a legal name for BOTH object kinds.
 *
 * ## The player tag
 *
 * `playerid` in the design is the caller's `whoami().id`. That id is a 12-character
 * base64url handle (ServerStore `src/core/keys.ts`: `ssk_<id>_<secret>`, id = 9
 * random bytes); its first 8 characters are exactly what ServerStore itself renders
 * as a key's public prefix (`prefix = ssk_ + the first 8 characters of the id`,
 * `src/server/app.ts:227`). So the object-name TAG is the **first 8 lowercased
 * characters of the full id** — short, stable and already public — while the FULL
 * id is kept INSIDE the player record and used for every identity comparison
 * ("is this me?", "is this the creator?"). A name collision is therefore
 * *detectable* (`lobby.ts` refuses rather than overwriting), which a truncated tag
 * alone could not guarantee.
 */

import { ServerStoreError, assertObjectName } from './transport'

/** Schema versions. A record from another version is refused, never guessed at. */
export const GAME_RECORD_VERSION = 2
export const PLAYER_RECORD_VERSION = 1

/**
 * The fewest seats a STARTED game may have. This is the ONE constant: `lobby.ts`
 * re-exports it as `MIN_PLAYERS_TO_START` (its rule is the same rule), and
 * {@link parseGameRecord} uses it so a started record with one seat cannot be
 * adopted as if it were a game. Two players is the engine's own floor
 * (`createGame` refuses fewer), so a lobby that started with fewer could never
 * have produced a playable state.
 */
export const MIN_SEATS = 2

export const GAME_STATUSES = ['lobby', 'started'] as const
export type GameStatus = (typeof GAME_STATUSES)[number]

/** The creator's identity: the full `whoami().id` plus the human label. */
export interface GameCreator {
  readonly id: string
  readonly label: string
}

/**
 * The body of `g.<gameid>.game`. Written only by the creator.
 *
 * ## `seatOrder` (S3)
 *
 * The explicit mapping from a **seat index** — the index into
 * `GameState.players`, which is what `activePlayerIndex` counts — to a player's
 * **full `whoami().id`**. It is written by the creator at Start and is the ONLY
 * thing that makes "whose turn is it?" agree across clients: every client derives
 * the same seat from the same list.
 *
 * It is EMPTY in the `lobby` status (there are no seats yet) and must hold at
 * least {@link MIN_SEATS} distinct full ids once the status is `started`. A
 * record without it is a version-1 record and is refused as
 * `unsupported_record_version`, never guessed at.
 */
export interface GameRecord {
  readonly version: number
  readonly gameId: string
  /** Anything the creator typed; the object NAME is a slug of this, not this. */
  readonly displayName: string
  readonly variant: string
  readonly creator: GameCreator
  readonly status: GameStatus
  readonly maxPlayers: number
  /** The seat index → full `whoami().id` mapping. Creator first. Empty before Start. */
  readonly seatOrder: string[]
  readonly createdAt: string
}

/** The body of `g.<gameid>.p.<tag>`. Written only by its owner. */
export interface PlayerRecord {
  readonly version: number
  readonly gameId: string
  /** The FULL `whoami().id` — the tag in the name is only its first 8 chars. */
  readonly playerId: string
  readonly label: string
  readonly joinedAt: string
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The service's own name rule, reused so the two can never drift. */
export const OBJECT_NAME_MAX_LENGTH = 64

/**
 * A game id is `<slug>-<8 hex>`. The cap leaves the player object ample room:
 * `g.` (2) + 32 + `.p.` (3) + 8 = 45 of the 64 available characters. An id that
 * carries the whole display name would make a legitimate join overflow; the
 * display name is in the body instead.
 */
export const MAX_GAME_ID_LENGTH = 32
export const GAME_ID_SUFFIX_LENGTH = 8
export const MAX_GAME_SLUG_LENGTH = MAX_GAME_ID_LENGTH - 1 - GAME_ID_SUFFIX_LENGTH
export const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

/** The tag in a player object name: the first 8 lowercased chars of the id. */
export const MAX_PLAYER_TAG_LENGTH = 8

/**
 * Discovery's filter, verbatim from the design: a game object is
 * `g.<gameid>.game`. A player object whose tag happens to be `game`
 * (`g.abc.p.game`) would also match this, so {@link parseGameObjectName}
 * excludes the player shape first.
 */
export const GAME_OBJECT_NAME_PATTERN = /^g\.([a-z0-9][a-z0-9._-]*)\.game$/
export const PLAYER_OBJECT_NAME_PATTERN = /^g\.([a-z0-9][a-z0-9._-]*)\.p\.([a-z0-9._-]+)$/

/** Turn a display name into the slug half of a game id. Never empty, never illegal. */
export function slugifyDisplayName(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_GAME_SLUG_LENGTH)
    .replace(/-+$/, '')
  return slug.length > 0 ? slug : 'game'
}

/** 8 lowercase hex characters from the platform CSPRNG (browser and Node 24). */
export function randomGameSuffix(): string {
  const bytes = new Uint8Array(GAME_ID_SUFFIX_LENGTH / 2)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function isLegalGameId(gameId: string): boolean {
  return GAME_ID_PATTERN.test(gameId) && gameId.length <= MAX_GAME_ID_LENGTH
}

export function assertGameId(gameId: string, code = 'invalid_game_id'): string {
  if (!isLegalGameId(gameId)) {
    throw new ServerStoreError(
      code,
      `illegal game id ${JSON.stringify(gameId)}: want /${GAME_ID_PATTERN.source}/, at most ${MAX_GAME_ID_LENGTH} characters`,
    )
  }
  return gameId
}

/**
 * A game id for a display name: a readable slug plus a short random suffix, so
 * two games with the same name get different ids and can never overwrite each
 * other. The suffix is injectable so a test can be deterministic; production
 * callers let it default.
 */
export function gameIdFor(displayName: string, suffix: string = randomGameSuffix()): string {
  const normalised = suffix.toLowerCase()
  if (!/^[a-z0-9]+$/.test(normalised)) {
    throw new ServerStoreError(
      'invalid_game_id',
      `game-id suffix ${JSON.stringify(suffix)} is not lowercase alphanumeric`,
    )
  }
  return assertGameId(`${slugifyDisplayName(displayName)}-${normalised}`)
}

export function gameObjectName(gameId: string): string {
  return `g.${gameId}.game`
}

export function playerObjectName(gameId: string, tag: string): string {
  return `g.${gameId}.p.${tag}`
}

/**
 * The game id a game object name carries, or `null` when the name is not a game
 * object ("not a game", which discovery ignores). The PLAYER shape is excluded
 * first so `g.abc.p.game` is a player, never a game whose id is `abc.p`.
 */
export function parseGameObjectName(name: string): string | null {
  if (PLAYER_OBJECT_NAME_PATTERN.test(name)) return null
  const match = GAME_OBJECT_NAME_PATTERN.exec(name)
  return match ? match[1]! : null
}

/** The `(gameId, tag)` a player object name carries, or `null`. */
export function parsePlayerObjectName(name: string): { gameId: string; tag: string } | null {
  const match = PLAYER_OBJECT_NAME_PATTERN.exec(name)
  return match ? { gameId: match[1]!, tag: match[2]! } : null
}

/**
 * The tag that goes in this player's object name: the first
 * {@link MAX_PLAYER_TAG_LENGTH} lowercased characters of the FULL `whoami().id`
 * — the same public handle ServerStore renders as a key's `prefix`. Lowercasing
 * is required by the name rule; an id that cannot yield 8 legal characters is
 * refused LOUDLY rather than truncated into something that might collide.
 */
export function playerTagFor(identityId: string): string {
  const tag = identityId.trim().toLowerCase().slice(0, MAX_PLAYER_TAG_LENGTH)
  if (!/^[a-z0-9._-]{8}$/.test(tag)) {
    throw new ServerStoreError(
      'invalid_player_id',
      `the identity id ${JSON.stringify(identityId)} cannot yield a legal ${MAX_PLAYER_TAG_LENGTH}-character player tag`,
    )
  }
  return tag
}

/**
 * The seat order the creator writes at Start: **the creator first, then every
 * other joined player sorted by tag** (the same 8-character public handle the
 * object names use, full id as the tie-break so the order is total).
 *
 * This is a pure function of the joined player records, so two clients that read
 * the same store derive the SAME seats — which is the whole point. It is written
 * once, by the creator, and read by everyone after.
 */
export function seatOrderFor(creatorId: string, players: readonly PlayerRecord[]): string[] {
  const others = players
    .filter((player) => player.playerId !== creatorId)
    .sort((a, b) => {
      const byTag = playerTagFor(a.playerId).localeCompare(playerTagFor(b.playerId))
      return byTag !== 0 ? byTag : a.playerId.localeCompare(b.playerId)
    })
    .map((player) => player.playerId)
  return [creatorId, ...others]
}

/**
 * The seat index of `playerId` in a record, or **-1** for a spectator (joined,
 * or not, but not seated). A spectator is told so by the UI; it is never
 * silently treated as seat 0.
 */
export function seatIndexOf(record: GameRecord, playerId: string): number {
  return record.seatOrder.indexOf(playerId)
}

// ---------------------------------------------------------------------------
// Serialise / parse
// ---------------------------------------------------------------------------

export function serializeGameRecord(record: GameRecord): string {
  return JSON.stringify(record)
}

export function serializePlayerRecord(record: PlayerRecord): string {
  return JSON.stringify(record)
}

function preview(text: string): string {
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

function asRecord(text: string, code: string, what: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ServerStoreError(code, `${what} is not JSON: ${preview(text)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ServerStoreError(code, `${what} is not a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function requireString(
  record: Record<string, unknown>,
  field: string,
  code: string,
  what: string,
): string {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new ServerStoreError(code, `${what}.${field} must be a non-empty string`)
  }
  return value
}

function requireInteger(
  record: Record<string, unknown>,
  field: string,
  code: string,
  what: string,
  min: number,
): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new ServerStoreError(code, `${what}.${field} must be an integer >= ${min}`)
  }
  return value
}

function requireVersion(
  record: Record<string, unknown>,
  expected: number,
  code: string,
  what: string,
): void {
  const value = record['version']
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ServerStoreError(code, `${what}.version must be an integer`)
  }
  if (value !== expected) {
    throw new ServerStoreError(
      'unsupported_record_version',
      `${what} is schema version ${value}; this client reads and writes version ${expected}`,
    )
  }
}

function requireTimestamp(
  record: Record<string, unknown>,
  field: string,
  code: string,
  what: string,
): string {
  const value = requireString(record, field, code, what)
  if (Number.isNaN(Date.parse(value))) {
    throw new ServerStoreError(code, `${what}.${field} is not a date: ${JSON.stringify(value)}`)
  }
  return value
}

function requireObject(
  record: Record<string, unknown>,
  field: string,
  code: string,
  what: string,
): Record<string, unknown> {
  const value = record[field]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ServerStoreError(code, `${what}.${field} must be an object`)
  }
  return value as Record<string, unknown>
}

/** Parse and validate a game body. A malformed body is `bad_game_record`. */
export function parseGameRecord(text: string): GameRecord {
  const code = 'bad_game_record'
  const what = 'game record'
  const record = asRecord(text, code, what)
  requireVersion(record, GAME_RECORD_VERSION, code, what)
  const gameId = requireString(record, 'gameId', code, what)
  assertGameId(gameId, code)
  const status = requireString(record, 'status', code, what)
  if (!(GAME_STATUSES as readonly string[]).includes(status)) {
    throw new ServerStoreError(
      code,
      `${what}.status is ${JSON.stringify(status)}; want one of ${GAME_STATUSES.join(', ')}`,
    )
  }
  const creator = requireObject(record, 'creator', code, what)
  const seatOrder = requireSeatOrder(record, status as GameStatus, code, what)
  return {
    version: GAME_RECORD_VERSION,
    gameId,
    displayName: requireString(record, 'displayName', code, what),
    variant: requireString(record, 'variant', code, what),
    creator: {
      id: requireString(creator, 'id', code, `${what}.creator`),
      label: requireString(creator, 'label', code, `${what}.creator`),
    },
    status: status as GameStatus,
    maxPlayers: requireInteger(record, 'maxPlayers', code, what, 2),
    seatOrder,
    createdAt: requireTimestamp(record, 'createdAt', code, what),
  }
}

/**
 * `seatOrder` is validated STRICTLY, and its rule depends on the status:
 *
 *  - `lobby`   → present and EMPTY (there are no seats before Start);
 *  - `started` → at least {@link MIN_SEATS} DISTINCT non-empty full ids.
 *
 * A missing field, a duplicate seat, or a started game with no seats is a loud
 * `bad_game_record` — never a guess, and never an empty seat list standing in
 * for a mapping the clients must agree on.
 */
function requireSeatOrder(
  record: Record<string, unknown>,
  status: GameStatus,
  code: string,
  what: string,
): string[] {
  const value = record['seatOrder']
  if (!Array.isArray(value)) {
    throw new ServerStoreError(code, `${what}.seatOrder must be an array of full player ids`)
  }
  const seats: string[] = []
  for (const seat of value) {
    if (typeof seat !== 'string' || seat.length === 0) {
      throw new ServerStoreError(code, `${what}.seatOrder holds a non-string or empty seat`)
    }
    seats.push(seat)
  }
  if (new Set(seats).size !== seats.length) {
    throw new ServerStoreError(code, `${what}.seatOrder lists the same player in two seats`)
  }
  if (status === 'lobby' && seats.length !== 0) {
    throw new ServerStoreError(
      code,
      `${what}.seatOrder is written at Start; a lobby record must have no seats, this one has ${seats.length}`,
    )
  }
  if (status === 'started' && seats.length < MIN_SEATS) {
    throw new ServerStoreError(
      code,
      `${what} is started with ${seats.length} seat(s); a playable game needs at least ${MIN_SEATS}`,
    )
  }
  return seats
}

/** Parse and validate a player body. A malformed body is `bad_player_record`. */
export function parsePlayerRecord(text: string): PlayerRecord {
  const code = 'bad_player_record'
  const what = 'player record'
  const record = asRecord(text, code, what)
  requireVersion(record, PLAYER_RECORD_VERSION, code, what)
  const gameId = requireString(record, 'gameId', code, what)
  assertGameId(gameId, code)
  return {
    version: PLAYER_RECORD_VERSION,
    gameId,
    playerId: requireString(record, 'playerId', code, what),
    label: requireString(record, 'label', code, what),
    joinedAt: requireTimestamp(record, 'joinedAt', code, what),
  }
}

/**
 * Parse the object named `objectName`: the body must be a valid game record AND
 * its `gameId` must be the one the name carries, so a name and a body that
 * disagree are never quietly accepted as the same game.
 */
export function parseGameObjectRecord(objectName: string, text: string): GameRecord {
  const record = parseGameRecord(text)
  const fromName = parseGameObjectName(objectName)
  if (fromName !== record.gameId) {
    throw new ServerStoreError(
      'bad_game_record',
      `${objectName} carries gameId ${JSON.stringify(record.gameId)} — the name and the body disagree`,
    )
  }
  return record
}

/** The name a game object must have, checked against the service's own rule. */
export function assertGameObjectName(gameId: string): string {
  return assertObjectName(gameObjectName(gameId))
}

/** The name a player object must have, checked against the service's own rule. */
export function assertPlayerObjectName(gameId: string, tag: string): string {
  return assertObjectName(playerObjectName(gameId, tag))
}
