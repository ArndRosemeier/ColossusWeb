// @vitest-environment jsdom
/**
 * The key-handling pins, under the owner's rule (2026-09-28):
 *
 *   *"Players need to provide their key. With that key the app needs to try to
 *   connect to the colossus store and immediately reject it if it does not work.
 *   Otherwise store it in local storage."*
 *
 * Phrased as statements:
 *  1. the key is stored ONLY in `localStorage` under ONE name — never
 *     `sessionStorage`, a cookie, the URL, `history` or a log;
 *  2. an INVALID key is never persisted (validation strictly precedes
 *     persistence — so after a failed attempt storage may legitimately be EMPTY);
 *  3. a stored key is re-validated on load and REMOVED from storage if it fails;
 *  4. the key travels only in the `Authorization` header (asserted in
 *     `serverStore.test.ts`, over the requests the transport actually made).
 *
 * Everything here drives the same `connect`/`restoreStoredKey` seam the panel
 * does, and asserts over the REAL browser objects — never by grepping source.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connect, forget, hasStoredKey, restoreStoredKey } from '../connect'
import { getKey, isConnected } from '../keyStore'
import { KEY_STORAGE_KEY } from '../keyStorage'
import { createMemoryTransport } from '../memoryTransport'
import { ServerStoreError } from '../transport'
import { TEST_IDENTITY, TEST_KEY } from './transportHarness'

/** A URL that ALREADY carries key-shaped text, so a no-op is visible as a no-op. */
const PROBE_QUERY = '?k=ssk_previous_session_KEYMATERIAL'
const PROBE_COOKIE = 'colossus_probe=1'

function dumpStorage(storage: Storage): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  for (let i = 0; i < storage.length; i++) {
    const name = storage.key(i)
    if (name === null) continue
    entries.push([name, storage.getItem(name) ?? ''])
  }
  return entries
}

function storageText(storage: Storage): string {
  return JSON.stringify(dumpStorage(storage))
}

function refusingTransport(code = 'unauthorized', message = 'key unknown, revoked or expired') {
  return createMemoryTransport({
    identity: structuredClone(TEST_IDENTITY),
    failures: { 'GET /whoami': new ServerStoreError(code, message, 401) },
  })
}

function acceptingTransport() {
  return createMemoryTransport({ identity: structuredClone(TEST_IDENTITY) })
}

/** Everything on the page that could hold a key, as one searchable string. */
function pageState(): string {
  return [
    storageText(window.localStorage),
    storageText(window.sessionStorage),
    window.location.href,
    window.location.search,
    String(window.history.length),
    window.document.cookie,
  ].join('\n')
}

beforeEach(() => {
  forget()
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState(null, '', `/ColossusWeb/${PROBE_QUERY}`)
  window.document.cookie = `${PROBE_COOKIE}; path=/`
})

describe('the caller key is stored in exactly one place', () => {
  it('writes the key to localStorage under the ONE named entry and nowhere else', async () => {
    const identity = await connect(acceptingTransport(), TEST_KEY)
    expect(identity.id).toBe(TEST_IDENTITY.id)
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBe(TEST_KEY)
    expect(dumpStorage(window.localStorage)).toEqual([[KEY_STORAGE_KEY, TEST_KEY]])

    // No second copy anywhere: not sessionStorage, not a cookie, not the URL,
    // not history. (The URL and cookie below were seeded BEFORE connecting.)
    expect(dumpStorage(window.sessionStorage)).toEqual([])
    expect(window.document.cookie).toBe(PROBE_COOKIE)
    expect(window.location.search).toBe(PROBE_QUERY)
    expect(window.document.cookie).not.toContain(TEST_KEY)
    expect(window.location.href).not.toContain(TEST_KEY)

    // The key appears in EXACTLY ONE place on the page: the one named entry.
    const carriers = [
      ['localStorage', storageText(window.localStorage)],
      ['sessionStorage', storageText(window.sessionStorage)],
      ['url', window.location.href],
      ['cookie', window.document.cookie],
    ].filter(([, text]) => text.includes(TEST_KEY))
    expect(carriers.map(([name]) => name)).toEqual(['localStorage'])
  })

  it('does not put the key in sessionStorage', async () => {
    await connect(acceptingTransport(), TEST_KEY)
    expect(storageText(window.sessionStorage)).not.toContain(TEST_KEY)
    // The one persisted copy is localStorage's, and it is the only one.
    const copies = [storageText(window.localStorage), storageText(window.sessionStorage)].filter(
      (text) => text.includes(TEST_KEY),
    )
    expect(copies).toHaveLength(1)
  })
})

describe('validation strictly precedes persistence', () => {
  it('persists NOTHING when the service refuses the key', async () => {
    await expect(connect(refusingTransport(), TEST_KEY)).rejects.toThrow(/key unknown/)
    // The trap this asserts against: storage may legitimately be EMPTY.
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBeNull()
    expect(dumpStorage(window.localStorage)).toEqual([])
    expect(getKey()).toBeNull()
    expect(isConnected()).toBe(false)
    expect(pageState()).not.toContain(TEST_KEY)
  })

  it('keeps the previous good key when a newly entered one is refused', async () => {
    await connect(acceptingTransport(), TEST_KEY)
    await expect(connect(refusingTransport(), 'ssk_replacement')).rejects.toThrow(/key unknown/)
    // The refused key replaced nothing: the working key is still the one held.
    expect(getKey()).toBe(TEST_KEY)
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBe(TEST_KEY)
    expect(pageState()).not.toContain('ssk_replacement')
  })

  it('rejects a key whose identity cannot be parsed, and stores nothing', async () => {
    const broken = createMemoryTransport({
      identity: structuredClone(TEST_IDENTITY),
      failures: {
        'GET /whoami': new ServerStoreError('bad_response', 'whoami is not a string[]'),
      },
    })
    await expect(connect(broken, TEST_KEY)).rejects.toThrow(/whoami is not a string\[\]/)
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBeNull()
  })

  it('rejects a network failure, and stores nothing', async () => {
    const offline = createMemoryTransport({
      identity: structuredClone(TEST_IDENTITY),
      failures: {
        'GET /whoami': new ServerStoreError('transport_error', 'request failed: Failed to fetch'),
      },
    })
    await expect(connect(offline, TEST_KEY)).rejects.toThrow(/Failed to fetch/)
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBeNull()
  })
})

describe('a stored key is re-validated on load', () => {
  it('treats a still-valid stored key as connected, without writing it again', async () => {
    window.localStorage.setItem(KEY_STORAGE_KEY, TEST_KEY)
    const identity = await restoreStoredKey(acceptingTransport())
    expect(identity?.id).toBe(TEST_IDENTITY.id)
    expect(getKey()).toBe(TEST_KEY)
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBe(TEST_KEY)
  })

  it('REMOVES a stored key that no longer validates and surfaces the refusal', async () => {
    window.localStorage.setItem(KEY_STORAGE_KEY, TEST_KEY)
    await expect(restoreStoredKey(refusingTransport('unauthorized', 'key unknown, revoked or expired')))
      .rejects.toThrow(/key unknown, revoked or expired/)
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBeNull()
    expect(getKey()).toBeNull()
    expect(isConnected()).toBe(false)
    expect(hasStoredKey()).toBe(false)
  })

  it('removes a stored key when the store cannot be reached at all', async () => {
    window.localStorage.setItem(KEY_STORAGE_KEY, TEST_KEY)
    await expect(
      restoreStoredKey(
        createMemoryTransport({
          identity: structuredClone(TEST_IDENTITY),
          failures: {
            'GET /whoami': new ServerStoreError('transport_error', 'request failed: Failed to fetch'),
          },
        }),
      ),
    ).rejects.toThrow(/Failed to fetch/)
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBeNull()
    expect(getKey()).toBeNull()
  })

  it('is a no-op when nothing is stored — a first visit is not a failure', async () => {
    expect(await restoreStoredKey(acceptingTransport())).toBeNull()
    expect(getKey()).toBeNull()
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBeNull()
  })
})

describe('forget', () => {
  it('removes the key from localStorage and from memory', async () => {
    await connect(acceptingTransport(), TEST_KEY)
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBe(TEST_KEY)
    forget()
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBeNull()
    expect(getKey()).toBeNull()
    expect(isConnected()).toBe(false)
    expect(pageState()).not.toContain(TEST_KEY)
  })

  it('is safe when there was nothing to forget', () => {
    expect(() => forget()).not.toThrow()
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBeNull()
  })
})

describe('the local storage write is loud, not silent', () => {
  it('reports a storage failure instead of leaving a key that looks saved', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    try {
      await expect(connect(acceptingTransport(), TEST_KEY)).rejects.toThrow(
        /could not write colossusweb\.key\.v1/,
      )
    } finally {
      spy.mockRestore()
    }
    expect(window.localStorage.getItem(KEY_STORAGE_KEY)).toBeNull()
  })
})
