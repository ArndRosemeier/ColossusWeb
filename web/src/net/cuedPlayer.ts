/**
 * The cued.de player of this tab — the ONE place ColossusWeb reads the pass.
 *
 * cued (Frank Zimmer's friends' portal) shows the game in a sandboxed iframe and
 * appends `#cued=<pass>` to the URL (gameserver repo, `docs/CUED.md`). `cued.ts`
 * (copied verbatim from the gameserver repo) reads it, strips it from the address
 * bar and keeps it for this tab.
 *
 * TRUST: the browser cannot verify the pass (the key must never ship), so it is
 * used for DISPLAY only — the badge, and the name other players see in online
 * games. Nothing here grants a seat or a result.
 *
 * Without a pass the app runs exactly as before. A malformed pass is a LOUD
 * failure on screen, never an invented player; an expired one is a hint to
 * reopen the game from cued, and its name is not used.
 */

import { CuedPassError, loadCuedSession, type CuedIdentity } from './cued'
import { describeFailure, NetError, type FailureDescription } from './failure'

export const CUED_STORAGE_KEY = 'colossusweb.cued-pass'

export interface CuedPlayer {
  /** The pass's player, or null when the game was not opened from cued. */
  readonly identity: CuedIdentity | null
  /** True when there was a pass but its 6 hours are over. */
  readonly expired: boolean
  /** A pass that could not be read. */
  readonly failure: FailureDescription | null
}

export const NO_CUED_PLAYER: CuedPlayer = { identity: null, expired: false, failure: null }

/** Read once at startup. Never throws: a bad pass becomes `failure`. */
export function readCuedPlayer(storageKey = CUED_STORAGE_KEY): CuedPlayer {
  if (typeof window === 'undefined') return NO_CUED_PLAYER
  try {
    const session = loadCuedSession(storageKey)
    if (session === null) return NO_CUED_PLAYER
    return { identity: session.identity, expired: session.expired, failure: null }
  } catch (error) {
    const failure =
      error instanceof CuedPassError
        ? describeFailure(new NetError('bad_cued_pass', `${error.message} — reopen Colossus from cued`))
        : describeFailure(error)
    return { identity: null, expired: false, failure }
  }
}

/** The name online play should use: the cued name of a live pass, else null. */
export function cuedPlayerName(player: CuedPlayer): string | null {
  return player.identity !== null && !player.expired ? player.identity.name : null
}

/** The cued invitation room of a live pass, else null. */
export function cuedRoom(player: CuedPlayer): string | null {
  return player.identity !== null && !player.expired ? player.identity.room : null
}
