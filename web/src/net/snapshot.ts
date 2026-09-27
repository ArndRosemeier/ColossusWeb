/**
 * The snapshot protocol — the object NAME and the object BODY, pure, with no
 * React, no `fetch` and no game import. `sync.ts` drives it; the pins test
 * *this*.
 *
 * ## Why the name is the ordering
 *
 * A ServerStore object has a name, a `sha256`, a size and a creation time, and
 * **no server ordering, no CAS and no clock we may trust** (two clients can
 * disagree about the time by minutes). The one thing the service DOES guarantee
 * is that object names are unique and lexicographically sortable — so the name
 * carries the state's position and the greatest name IS the newest state:
 *
 *     g.<gameid>.s.<tttt>.<sss>.<tag>
 *
 *  - `tttt` — the state's `turnNumber`, zero-padded to 4;
 *  - `sss`  — the publish counter **within that turn**, zero-padded to 3;
 *  - `tag`  — the writer's 8-character public handle (`playerTagFor`).
 *
 * Two writers that publish from the same parent produce the same `(turn, seq)`
 * with DIFFERENT tags: a race is two visible objects (a FORK), never a silent
 * lost update — the store has no ETag/If-Match, so this is the whole concurrency
 * story.
 *
 * ## What `sss` actually is (a measured correction to the first reading)
 *
 * `GameState.turnNumber` is the **round**, not one player's turn: in a 3-player
 * game `activePlayerIndex` runs 0 → 1 → 2 while `turnNumber` stays 1
 * (`GameEngine.ts`: `if (next <= state.activePlayerIndex) state.turnNumber += 1`).
 * An INDEPENDENT per-writer counter reset each turn therefore does not order
 * states within a round — player 0's `s.0001.002` would beat player 1's newer
 * `s.0001.000`, and the newest move would be ignored.
 *
 * So `sss` is the successor of the counter of the snapshot this state was
 * DERIVED FROM (the `parent`): adopting a snapshot sets the local counter to its
 * `(turn, seq)`, and the next publish writes `seq + 1` — or `0` when the round
 * has advanced. That is what makes the name monotonic along the chain while
 * still resetting each turn, and it is why the body carries `parent`. Two
 * clients deriving from the SAME parent still collide on `(turn, seq)` and fork.
 *
 * Three digits cap a round at 1000 publishes; beyond that the zero padding would
 * sort out of order, so {@link snapshotObjectName} REFUSES loudly instead of
 * minting a name that lies.
 */

import { SAVE_VERSION, type SavedGameBlob } from '../persistence/saveGame'
import {
  MAX_GAME_ID_LENGTH,
  MAX_PLAYER_TAG_LENGTH,
  OBJECT_NAME_MAX_LENGTH,
  assertGameId,
} from './gameRecord'
import { ServerStoreError, assertObjectName, type StoreObject } from './transport'

/** The body schema this client writes and the only one it reads. */
export const SNAPSHOT_SCHEMA_VERSION = 1

export const SNAPSHOT_TURN_DIGITS = 4
export const SNAPSHOT_SEQ_DIGITS = 3
/** `9999` — past this the 4-digit field would sort before a smaller turn. */
export const MAX_SNAPSHOT_TURN = 10 ** SNAPSHOT_TURN_DIGITS - 1
/** `999` — past this the 3-digit field would sort before a smaller seq. */
export const MAX_SNAPSHOT_SEQ = 10 ** SNAPSHOT_SEQ_DIGITS - 1

/** The `s` of `g.<gameid>.s.<turn>.<seq>.<tag>`. */
export const SNAPSHOT_MARKER = 's'

/** A writer tag is exactly what `playerTagFor` mints: 8 legal name characters. */
export const SNAPSHOT_TAG_PATTERN = /^[a-z0-9._-]{8}$/

/** The full name shape. Anchored, and the gameId group is greedy. */
export const SNAPSHOT_OBJECT_NAME_PATTERN =
  /^g\.([a-z0-9][a-z0-9._-]*)\.s\.(\d{4})\.(\d{3})\.([a-z0-9._-]{8})$/

export interface SnapshotRef {
  /** The object's full name — the ordering key. */
  readonly name: string
  readonly gameId: string
  readonly turn: number
  readonly seq: number
  readonly tag: string
}

/** A fork: two writers published at the same `(turn, seq)`. */
export interface SnapshotFork {
  readonly turn: number
  readonly seq: number
  /** Every name at that position, sorted — a human can see both writers. */
  readonly names: string[]
}

/** What a body says about itself. Never contains key material. */
export interface SnapshotHeader {
  readonly schemaVersion: number
  /** Its own object name — the body and the name must agree. */
  readonly name: string
  readonly gameId: string
  readonly turn: number
  readonly seq: number
  readonly writerTag: string
  /** The writer's seat index in the game record's `seatOrder`. */
  readonly seat: number
  /** The FULL NAME of the snapshot this state was derived from; `null` for the first. */
  readonly parent: string | null
  readonly createdAt: string
}

/**
 * The body: a small header plus the output of **`serializeGame`** — the ONE
 * state serialiser (`web/src/persistence/saveGame.ts`). `serializeGame` already
 * strips the heavy `variant` payload, so nothing here invents a second format;
 * `adopt` feeds this blob straight back into `deserializeGame`.
 */
export interface SnapshotBody {
  readonly header: SnapshotHeader
  readonly state: SavedGameBlob
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

function pad(value: number, digits: number, what: string, max: number): string {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new ServerStoreError(
      'snapshot_budget_exceeded',
      `${what} must be an integer in 0..${max}, got ${JSON.stringify(value)}; beyond that the zero-padded snapshot name would sort out of order`,
    )
  }
  return String(value).padStart(digits, '0')
}

/**
 * The object name of one snapshot. Every field is validated here, once, so an
 * out-of-range turn/seq or an illegal tag is refused LOCALLY and identically for
 * both transports — never minted into a name that sorts wrongly.
 */
export function snapshotObjectName(gameId: string, turn: number, seq: number, tag: string): string {
  assertGameId(gameId)
  const turnPart = pad(turn, SNAPSHOT_TURN_DIGITS, 'snapshot turn', MAX_SNAPSHOT_TURN)
  const seqPart = pad(seq, SNAPSHOT_SEQ_DIGITS, 'snapshot seq', MAX_SNAPSHOT_SEQ)
  if (!SNAPSHOT_TAG_PATTERN.test(tag)) {
    throw new ServerStoreError(
      'invalid_player_id',
      `snapshot writer tag ${JSON.stringify(tag)} is not exactly ${MAX_PLAYER_TAG_LENGTH} legal name characters`,
    )
  }
  return assertObjectName(`g.${gameId}.s.${turnPart}.${seqPart}.${tag}`)
}

/**
 * The LONGEST snapshot name the game-id cap allows, with the highest legal
 * turn/seq and a maximal tag. This is the budget assertion the brief asks for:
 * `gameid <= 32` + `g.` + `.s.` + 4 + `.` + 3 + `.` + 8 must fit the service's
 * 64-character rule. It is a function so a pin can PRINT the number, and it is
 * also exercised implicitly by every real name (`assertObjectName`).
 */
export function longestSnapshotObjectName(
  gameId: string = 'x'.repeat(MAX_GAME_ID_LENGTH),
): string {
  return snapshotObjectName(
    gameId,
    MAX_SNAPSHOT_TURN,
    MAX_SNAPSHOT_SEQ,
    'z'.repeat(MAX_PLAYER_TAG_LENGTH),
  )
}

/** The length of {@link longestSnapshotObjectName}; must be `<= 64`. */
export function snapshotNameBudget(): number {
  const longest = longestSnapshotObjectName()
  if (longest.length > OBJECT_NAME_MAX_LENGTH) {
    throw new ServerStoreError(
      'snapshot_name_too_long',
      `the longest legal snapshot name is ${longest.length} characters; the service allows ${OBJECT_NAME_MAX_LENGTH}`,
    )
  }
  return longest.length
}

/**
 * The `(gameId, turn, seq, tag)` a snapshot name carries, or `null` when the
 * name is not a snapshot at all ("not mine", which a caller ignores). A name is
 * only accepted when rebuilding it from the parsed fields reproduces it
 * EXACTLY, so a gameId that itself contains `.s.` can never be mis-split.
 */
export function parseSnapshotObjectName(name: string): SnapshotRef | null {
  const match = SNAPSHOT_OBJECT_NAME_PATTERN.exec(name)
  if (!match) return null
  const ref: SnapshotRef = {
    name,
    gameId: match[1]!,
    turn: Number(match[2]),
    seq: Number(match[3]),
    tag: match[4]!,
  }
  if (snapshotObjectName(ref.gameId, ref.turn, ref.seq, ref.tag) !== name) return null
  return ref
}

/** Every snapshot ref in an object list that belongs to `gameId`, in store order. */
export function snapshotRefsForGame(
  objects: readonly StoreObject[],
  gameId: string,
): SnapshotRef[] {
  const refs: SnapshotRef[] = []
  for (const object of objects) {
    const ref = parseSnapshotObjectName(object.name)
    if (ref !== null && ref.gameId === gameId) refs.push(ref)
  }
  return refs
}

/** The greatest name is the newest state — the whole ordering, in one line. */
export function greatestSnapshotRef(refs: readonly SnapshotRef[]): SnapshotRef | null {
  let greatest: SnapshotRef | null = null
  for (const ref of refs) {
    if (greatest === null || ref.name > greatest.name) greatest = ref
  }
  return greatest
}

/** Every ref at the greatest `(turn, seq)` — the group adoption chooses from. */
export function newestSnapshotGroup(refs: readonly SnapshotRef[]): SnapshotRef[] {
  const greatest = greatestSnapshotRef(refs)
  if (greatest === null) return []
  return refs.filter((ref) => ref.turn === greatest.turn && ref.seq === greatest.seq)
}

/**
 * The fork at a group of same-`(turn, seq)` refs, or `null` when there is only
 * one writer there. A fork is DETECTED and SURFACED, never resolved silently.
 */
export function detectFork(group: readonly SnapshotRef[]): SnapshotFork | null {
  if (group.length < 2) return null
  const names = group.map((ref) => ref.name).sort()
  return { turn: group[0]!.turn, seq: group[0]!.seq, names }
}

/** One candidate at the newest position: its ref and the parent its body claims. */
export interface SnapshotCandidate {
  readonly ref: SnapshotRef
  readonly parent: string | null
}

/**
 * The deterministic choice among a forked group: the snapshot whose `parent` is
 * the one currently held, else the LOWEST tag. Never a guess, never silent — the
 * caller surfaces the fork through the app's error surface either way.
 */
export function chooseSnapshot(
  candidates: readonly SnapshotCandidate[],
  heldName: string | null,
): SnapshotCandidate {
  if (candidates.length === 0) {
    throw new ServerStoreError('bad_snapshot', 'no snapshot candidates to choose from')
  }
  const sorted = [...candidates].sort((a, b) =>
    a.ref.tag < b.ref.tag ? -1 : a.ref.tag > b.ref.tag ? 1 : 0,
  )
  const continuing = heldName === null ? undefined : sorted.find((c) => c.parent === heldName)
  return continuing ?? sorted[0]!
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

export function serializeSnapshot(body: SnapshotBody): string {
  return JSON.stringify({
    header: {
      schemaVersion: body.header.schemaVersion,
      name: body.header.name,
      gameId: body.header.gameId,
      turn: body.header.turn,
      seq: body.header.seq,
      writerTag: body.header.writerTag,
      seat: body.header.seat,
      parent: body.header.parent,
      createdAt: body.header.createdAt,
    },
    state: body.state,
  })
}

function preview(text: string): string {
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

function asRecord(text: unknown, code: string, what: string): Record<string, unknown> {
  if (typeof text !== 'object' || text === null || Array.isArray(text)) {
    throw new ServerStoreError(code, `${what} is not a JSON object`)
  }
  return text as Record<string, unknown>
}

function parseJsonObject(text: string, code: string, what: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ServerStoreError(code, `${what} is not JSON: ${preview(text)}`)
  }
  return asRecord(parsed, code, what)
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
  max: number,
): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ServerStoreError(
      code,
      `${what}.${field} must be an integer in ${min}..${max}, got ${JSON.stringify(value)}`,
    )
  }
  return value
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

/**
 * Parse and validate a snapshot body. EVERY field is checked and a failure is a
 * thrown `ServerStoreError` — it never becomes an empty or half-filled state
 * (`AGENTS.md` rule 3). The deepest state checks stay in `deserializeGame`, which
 * `adopt` calls; this boundary validates the blob's shape so a truncated body is
 * refused before it can reach the engine.
 */
export function parseSnapshot(text: string): SnapshotBody {
  const code = 'bad_snapshot'
  const what = 'snapshot'
  const outer = parseJsonObject(text, code, what)
  const headerRecord = asRecord(outer['header'], code, `${what}.header`)

  const schemaVersion = requireInteger(
    headerRecord,
    'schemaVersion',
    code,
    `${what}.header`,
    0,
    Number.MAX_SAFE_INTEGER,
  )
  if (schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new ServerStoreError(
      'unsupported_snapshot_version',
      `${what} is schema version ${schemaVersion}; this client reads and writes version ${SNAPSHOT_SCHEMA_VERSION}`,
    )
  }

  const gameId = requireString(headerRecord, 'gameId', code, `${what}.header`)
  assertGameId(gameId, code)
  const turn = requireInteger(
    headerRecord,
    'turn',
    code,
    `${what}.header`,
    0,
    MAX_SNAPSHOT_TURN,
  )
  const seq = requireInteger(headerRecord, 'seq', code, `${what}.header`, 0, MAX_SNAPSHOT_SEQ)
  const writerTag = requireString(headerRecord, 'writerTag', code, `${what}.header`)
  if (!SNAPSHOT_TAG_PATTERN.test(writerTag)) {
    throw new ServerStoreError(
      code,
      `${what}.header.writerTag ${JSON.stringify(writerTag)} is not a legal writer tag`,
    )
  }
  const seat = requireInteger(
    headerRecord,
    'seat',
    code,
    `${what}.header`,
    0,
    Number.MAX_SAFE_INTEGER,
  )
  const parentValue = headerRecord['parent']
  let parent: string | null = null
  if (parentValue !== null && parentValue !== undefined) {
    if (typeof parentValue !== 'string') {
      throw new ServerStoreError(code, `${what}.header.parent must be a snapshot name or null`)
    }
    const parentRef = parseSnapshotObjectName(parentValue)
    if (parentRef === null || parentRef.gameId !== gameId) {
      throw new ServerStoreError(
        code,
        `${what}.header.parent ${JSON.stringify(parentValue)} is not a snapshot of this game`,
      )
    }
    parent = parentValue
  }
  const createdAt = requireTimestamp(headerRecord, 'createdAt', code, `${what}.header`)

  // The name and the fields must agree: a body whose `name` was not built from
  // its own turn/seq/tag is corrupt, and adopting it would order wrongly.
  const name = requireString(headerRecord, 'name', code, `${what}.header`)
  if (snapshotObjectName(gameId, turn, seq, writerTag) !== name) {
    throw new ServerStoreError(
      code,
      `${what}.header.name ${JSON.stringify(name)} was not built from its own gameId/turn/seq/writerTag`,
    )
  }

  const state = parseBlob(outer['state'], code, what)

  return {
    header: { schemaVersion, name, gameId, turn, seq, writerTag, seat, parent, createdAt },
    state,
  }
}

/**
 * Validate the `serializeGame` blob's shape. The engine-level checks (legion
 * arrays, marker migration, dice ids) are `deserializeGame`'s, and `adopt` runs
 * them; this only refuses a body whose blob is not a save blob at all.
 */
function parseBlob(value: unknown, code: string, what: string): SavedGameBlob {
  const blob = asRecord(value, code, `${what}.state`)
  const version = blob['version']
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new ServerStoreError(code, `${what}.state.version must be an integer`)
  }
  if (version !== SAVE_VERSION) {
    throw new ServerStoreError(
      'unsupported_save_version',
      `${what}.state is save version ${version}; this client reads version ${SAVE_VERSION}`,
    )
  }
  requireTimestamp(blob, 'savedAt', code, `${what}.state`)
  const variantName = requireString(blob, 'variantName', code, `${what}.state`)
  const inner = blob['state']
  if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) {
    throw new ServerStoreError(code, `${what}.state.state must be the game state object`)
  }
  return {
    version: SAVE_VERSION,
    savedAt: blob['savedAt'] as string,
    variantName,
    state: inner as SavedGameBlob['state'],
  }
}
