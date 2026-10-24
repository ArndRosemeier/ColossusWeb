/**
 * Who this browser is, across reloads — the ONE local identity of online play.
 *
 * GameHub identifies players PER CONNECTION: a reload gets a new numeric id and
 * joins as a new player (`docs/PROTOCOL.md`, "Lifetimes"). A Titan game lasts for
 * hours and survives reloads, so a seat cannot be a connection id. Instead every
 * browser holds a random, stable `token` in `localStorage`; it is sent in the
 * `hello` message on every (re)join and a seat is bound to it. There is no
 * account and no key to paste — this is the honour system the owner chose for
 * ServerStore, kept as it was.
 *
 * A stored value that is present but malformed is a LOUD `bad_identity`, never
 * silently replaced: replacing it would cost the player their seats.
 */

import { NetError } from './failure'

export const IDENTITY_STORAGE_KEY = 'colossusweb.player.v1'
export const MAX_NAME_LENGTH = 32

export interface LocalPlayer {
  readonly token: string
  readonly name: string
}

const TOKEN_RE = /^p_[0-9a-f]{16}$/

export function isLegalToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value)
}

/** A display name as the server will accept it (GameHub caps names at 32 chars). */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
}

export function newToken(): string {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return 'p_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function storage(): Storage | null {
  return (globalThis.localStorage as Storage | undefined) ?? null
}

/** The stored player, or a fresh one (stored at once). A corrupt entry is LOUD. */
export function loadLocalPlayer(): LocalPlayer {
  const raw = storage()?.getItem(IDENTITY_STORAGE_KEY)
  if (raw === null || raw === undefined || raw.length === 0) {
    const fresh: LocalPlayer = { token: newToken(), name: '' }
    storage()?.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(fresh))
    return fresh
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new NetError('bad_identity', `${IDENTITY_STORAGE_KEY} is not JSON`)
  }
  const record = parsed as Partial<LocalPlayer> | null
  if (
    typeof record !== 'object' ||
    record === null ||
    !isLegalToken(record.token) ||
    typeof record.name !== 'string'
  ) {
    throw new NetError('bad_identity', `${IDENTITY_STORAGE_KEY} does not hold a {token, name} record`)
  }
  return { token: record.token, name: cleanName(record.name) }
}

/** Remember the display name (the token never changes). */
export function saveLocalPlayerName(player: LocalPlayer, name: string): LocalPlayer {
  const next: LocalPlayer = { token: player.token, name: cleanName(name) }
  storage()?.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(next))
  return next
}
