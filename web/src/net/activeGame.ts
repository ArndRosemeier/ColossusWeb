/**
 * The ONE local record of the online game this browser is in, so that a reload
 * goes straight back into it — and so that the game itself survives the room.
 *
 * GameHub keeps NOTHING on disk: a room with no players is deleted after 60 s
 * (`docs/PROTOCOL.md`, "Lifetimes"). A Titan game lasts longer than an evening, so
 * every client keeps its latest copy of the {@link RoomWorld} here. When the room
 * is gone, any seated player can RE-OPEN the game from this copy in a new room;
 * the others find it in the lobby by its `gameId` and rejoin their seats. If a
 * rejoining player's copy is newer, the host asks for it (`room.ts`, `send-backup`).
 *
 * A value that is present but malformed is a LOUD `bad_active_game`.
 */

import { NetError } from './failure'
import { parseWorld, type RoomWorld } from './room'

export const ACTIVE_GAME_STORAGE_KEY = 'colossusweb.online.v1'
/** The ServerStore-era pointer. Removed on first load; it names nothing on GameHub. */
const LEGACY_KEYS = ['colossusweb.multiplayer.v1', 'colossusweb.key.v1']

export interface ActiveGame {
  /** The room code the game was last seen in (it changes when the game is re-opened). */
  readonly code: string
  readonly world: RoomWorld
}

function storage(): Storage | null {
  return (globalThis.localStorage as Storage | undefined) ?? null
}

/** Remember the game (called on every world change). */
export function rememberActiveGame(code: string, world: RoomWorld): void {
  storage()?.setItem(ACTIVE_GAME_STORAGE_KEY, JSON.stringify({ version: 1, code, world }))
}

/** The remembered game, or null. A corrupt value is LOUD. */
export function readActiveGame(): ActiveGame | null {
  const store = storage()
  for (const key of LEGACY_KEYS) store?.removeItem(key)
  const raw = store?.getItem(ACTIVE_GAME_STORAGE_KEY)
  if (raw === null || raw === undefined || raw.length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new NetError('bad_active_game', `${ACTIVE_GAME_STORAGE_KEY} is not JSON`)
  }
  const record = parsed as { version?: unknown; code?: unknown; world?: unknown } | null
  if (typeof record !== 'object' || record === null || record.version !== 1 || typeof record.code !== 'string') {
    throw new NetError('bad_active_game', `${ACTIVE_GAME_STORAGE_KEY} is not a version-1 record`)
  }
  return { code: record.code, world: parseWorld(record.world) }
}

/** Forget it (left, finished, or "New game"). Idempotent. */
export function forgetActiveGame(): void {
  storage()?.removeItem(ACTIVE_GAME_STORAGE_KEY)
}
