/**
 * The caller's ServerStore key in MEMORY, for the page's own lifetime.
 *
 * This module is the memory half only: it installs, reads and forgets the key
 * and tells subscribers. WHERE a key may be written down is `keyStorage.ts`;
 * WHEN it may be written down (only after the service accepted it) is
 * `connect.ts`. Keeping those three apart is what makes "the key is persisted in
 * exactly one place, and only after validation" checkable.
 */

export type KeyListener = (key: string | null) => void

let key: string | null = null
const listeners = new Set<KeyListener>()

function emit(): void {
  const current = key
  for (const listener of listeners) listener(current)
}

/** Install the key in memory. Trims; a blank key is refused rather than held. */
export function installKey(next: string): void {
  const trimmed = next.trim()
  if (trimmed.length === 0) {
    throw new Error('refusing an empty ServerStore key')
  }
  key = trimmed
  emit()
}

/**
 * Drop the key from memory. A no-op when nothing is held, so it is safe to call
 * on every path (including one where a connection attempt already failed).
 */
export function forgetKey(): void {
  if (key === null) return
  key = null
  emit()
}

/**
 * The key itself, for the transport that must put it in the `Authorization`
 * header. This is the one accessor; callers that only need to know whether a
 * connection is live use {@link isConnected}.
 */
export function getKey(): string | null {
  return key
}

export function isConnected(): boolean {
  return key !== null
}

/** Subscribe to changes. Returns the unsubscribe function. */
export function subscribeToKey(listener: KeyListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
