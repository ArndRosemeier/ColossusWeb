/**
 * The ONE place the caller's ServerStore key is written down — `localStorage`,
 * under a single named entry, holding the key string and nothing else.
 *
 * The owner's rule, verbatim: *"Players need to provide their key. With that key
 * the app needs to try to connect to the colossus store and immediately reject it
 * if it does not work. Otherwise store it in local storage."* So persistence is
 * real, and it is the ONLY persistence: never `sessionStorage`, never a cookie,
 * never the URL, the history or a log.
 *
 * Every access goes through here, so "is the key written anywhere else?" is
 * answerable by reading one file. This module knows nothing about validation —
 * `connect.ts` decides WHEN a key may be written (only after `whoami` accepted
 * it); this module decides WHERE.
 */

/** The one entry. Versioned, like the save file's `colossusweb.save.v1`. */
export const KEY_STORAGE_KEY = 'colossusweb.key.v1'

/** A storage failure is LOUD — a key that cannot be written must not look saved. */
export class KeyStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeyStorageError'
    Object.setPrototypeOf(this, KeyStorageError.prototype)
  }
}

/**
 * The real store when the page has one. `null` means there is genuinely no
 * `localStorage` (a server-side render, or a privacy configuration that removes
 * it) — a missing FEATURE, which is reported by the absence of a place to save,
 * never by pretending a failed read found nothing.
 */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** The stored key, or `null`. A read failure is loud, not an empty answer. */
export function readStoredKey(): string | null {
  const store = storage()
  if (store === null) return null
  try {
    return store.getItem(KEY_STORAGE_KEY)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new KeyStorageError(`could not read ${KEY_STORAGE_KEY} from localStorage: ${detail}`)
  }
}

/** Write the key under the one entry. Used only after the key has VALIDATED. */
export function writeStoredKey(key: string): void {
  const store = storage()
  if (store === null) {
    throw new KeyStorageError('no localStorage in this environment — the key cannot be saved')
  }
  try {
    store.setItem(KEY_STORAGE_KEY, key)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new KeyStorageError(`could not write ${KEY_STORAGE_KEY} to localStorage: ${detail}`)
  }
}

/** Remove the key. A no-op when there is nothing stored (or nothing to store into). */
export function clearStoredKey(): void {
  const store = storage()
  if (store === null) return
  try {
    store.removeItem(KEY_STORAGE_KEY)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new KeyStorageError(`could not remove ${KEY_STORAGE_KEY} from localStorage: ${detail}`)
  }
}
