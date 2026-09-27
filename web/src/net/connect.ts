/**
 * The connection lifecycle — the ONE seam that decides whether a key is real
 * before anything is done with it.
 *
 * The owner's rule, verbatim: *"With that key the app needs to try to connect to
 * the colossus store and immediately reject it if it does not work. Otherwise
 * store it in local storage."*
 *
 * That gives one ordering, enforced in both directions:
 *
 *   submit  →  whoami  →  accepted?  →  persist;  refused?  →  reject, persist NOTHING
 *   load    →  whoami  →  accepted?  →  connected; refused? →  remove from storage
 *
 * A refusal is never swallowed: whatever the transport threw (401/403, an
 * unparseable body, a CORS or network failure) is rethrown unchanged so the
 * panel can show the service's own `code` and `message`.
 */

import { readStoredKey, writeStoredKey, clearStoredKey } from './keyStorage'
import { forgetKey, getKey, installKey } from './keyStore'
import type { ServerStoreTransport, StoreIdentity } from './transport'

/**
 * Validate the player's key and, only on success, remember it for the next
 * visit. On failure the key is not left in memory either, so nothing downstream
 * can accidentally use a key the service refused.
 */
export async function connect(
  transport: ServerStoreTransport,
  candidate: string,
): Promise<StoreIdentity> {
  const previous = getKey()
  installKey(candidate)
  try {
    const identity = await transport.whoami()
    // STRICTLY AFTER the service accepted it.
    writeStoredKey(getKey() as string)
    return identity
  } catch (error) {
    // A refused key never reaches the store's shelf, and never stays in memory
    // in place of a key that was working before.
    if (previous === null) forgetKey()
    else installKey(previous)
    throw error
  }
}

/**
 * Validate whatever was stored by an earlier visit, BEFORE the player is treated
 * as connected. A key that no longer validates (revoked, expired, service down)
 * is REMOVED from storage and the refusal is returned — never kept as a
 * maybe-connection.
 *
 * Returns `null` when there was nothing stored (not an error: a first visit).
 */
export async function restoreStoredKey(
  transport: ServerStoreTransport,
): Promise<StoreIdentity | null> {
  const stored = readStoredKey()
  if (stored === null) return null
  try {
    return await connect(transport, stored)
  } catch (error) {
    clearStoredKey()
    forgetKey()
    throw error
  }
}

/** Forget the key: out of memory AND out of `localStorage`. The panel's action. */
export function forget(): void {
  forgetKey()
  clearStoredKey()
}

/** True when a key is present in storage, i.e. a re-validation may be due. */
export function hasStoredKey(): boolean {
  return readStoredKey() !== null
}
