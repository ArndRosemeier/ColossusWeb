/**
 * The ONE local pointer to the multiplayer game this client is inside, so that
 * opening or reloading the app offers to RESUME it (adopt the latest snapshot)
 * instead of starting a fresh local game.
 *
 * It lives in `localStorage` beside the key (`keyStorage.ts` owns
 * `colossusweb.key.v1`; this owns `colossusweb.multiplayer.v1`) and holds ONLY
 * the game id — never a snapshot, never a seat, never key material. The store is
 * the source of truth for everything else, so a stale pointer is harmless: the
 * lobby reads the game and drops the pointer if it is gone.
 *
 * A value that is present but not a legal game id is a LOUD
 * `bad_active_game` — a corrupted pointer must not be silently ignored and then
 * look like "no game to resume".
 */

import { isLegalGameId } from './gameRecord'
import { ServerStoreError } from './transport'

/** The ONE `localStorage` entry. */
export const ACTIVE_GAME_STORAGE_KEY = 'colossusweb.multiplayer.v1'

interface ActiveGameRecord {
  version: 1
  gameId: string
}

function storage(): Storage | null {
  const candidate = globalThis.localStorage as Storage | undefined
  return candidate ?? null
}

/** Remember `gameId` as the game to resume. */
export function rememberActiveGame(gameId: string): void {
  if (!isLegalGameId(gameId)) {
    throw new ServerStoreError(
      'bad_active_game',
      `refusing to remember ${JSON.stringify(gameId)}: not a legal game id`,
    )
  }
  const record: ActiveGameRecord = { version: 1, gameId }
  storage()?.setItem(ACTIVE_GAME_STORAGE_KEY, JSON.stringify(record))
}

/** The remembered game id, or null when there is none. A corrupt value is LOUD. */
export function readActiveGame(): string | null {
  const raw = storage()?.getItem(ACTIVE_GAME_STORAGE_KEY)
  if (raw === null || raw === undefined || raw.length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ServerStoreError(
      'bad_active_game',
      `${ACTIVE_GAME_STORAGE_KEY} is not JSON: ${raw.slice(0, 120)}`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ServerStoreError('bad_active_game', `${ACTIVE_GAME_STORAGE_KEY} is not an object`)
  }
  const record = parsed as Partial<ActiveGameRecord>
  if (record.version !== 1 || typeof record.gameId !== 'string' || !isLegalGameId(record.gameId)) {
    throw new ServerStoreError(
      'bad_active_game',
      `${ACTIVE_GAME_STORAGE_KEY} does not hold a version-1 record with a legal game id`,
    )
  }
  return record.gameId
}

/** Forget the pointer (game finished, left, or deleted). Idempotent. */
export function forgetActiveGame(): void {
  storage()?.removeItem(ACTIVE_GAME_STORAGE_KEY)
}
