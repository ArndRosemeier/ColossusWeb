/**
 * An in-memory implementation of the SAME {@link ServerStoreTransport} contract.
 *
 * It exists so the lobby and the sync slices can be built and TESTED with no
 * network at all — and so anything that must run offline has one implementation
 * to pick. It mirrors the service's observable rules, including the ones that
 * bite: an unconditional overwrite (no CAS), an empty body refused, and the same
 * error codes. It is not a stub that always succeeds — a failure it would not
 * produce is a failure the real service would.
 */

import {
  ServerStoreError,
  assertObjectName,
  assertStoreName,
  type GetResult,
  type PutResult,
  type ServerStoreTransport,
  type StoreIdentity,
  type StoreObject,
} from './transport'

interface StoredObject {
  value: string
  sha256: string
  createdAt: string
}

export interface MemoryTransportOptions {
  /** The identity `whoami()` reports. */
  identity: StoreIdentity
  /**
   * Scripted failures, keyed by `"<METHOD> <store>/<name>"` (or
   * `"<METHOD> <store>"` for `list`). When a matching entry exists the call
   * throws exactly that error — for testing the error path without a network.
   */
  failures?: Record<string, ServerStoreError>
}

/**
 * `crypto.subtle` is the one digest that exists in BOTH a browser and Node 24,
 * so the fake names content exactly as the service does with no dependency.
 */
async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export class MemoryTransport implements ServerStoreTransport {
  private readonly objects = new Map<string, StoredObject>()
  private readonly failures: Record<string, ServerStoreError>
  private identity: StoreIdentity

  constructor(options: MemoryTransportOptions) {
    this.identity = options.identity
    this.failures = options.failures ?? {}
  }

  /** The objects currently held, for a test that wants to inspect them directly. */
  snapshot(): StoreObject[] {
    return this.listSync()
  }

  private listSync(): StoreObject[] {
    return [...this.objects.entries()]
      .map(([key, stored]) => {
        const [store, name] = key.split('\u0000') as [string, string]
        return {
          store,
          name,
          sha256: stored.sha256,
          size: byteLength(stored.value),
          createdAt: stored.createdAt,
        }
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  private fail(method: string, store: string, name?: string): void {
    const key = name === undefined ? `${method} ${store}` : `${method} ${store}/${name}`
    const failure = this.failures[key]
    if (failure) throw failure
  }

  async list(store: string): Promise<StoreObject[]> {
    assertStoreName(store)
    this.fail('LIST', store)
    return this.listSync().filter((object) => object.store === store)
  }

  async get(store: string, name: string): Promise<GetResult> {
    assertStoreName(store)
    assertObjectName(name)
    this.fail('GET', store, name)
    const stored = this.objects.get(`${store}\u0000${name}`)
    if (!stored) {
      throw new ServerStoreError(
        'not_found',
        `no object ${JSON.stringify(name)} in store ${JSON.stringify(store)}`,
        404,
      )
    }
    return { value: stored.value, sha256: stored.sha256 }
  }

  async put(store: string, name: string, value: string): Promise<PutResult> {
    assertStoreName(store)
    assertObjectName(name)
    this.fail('PUT', store, name)
    if (value.length === 0) {
      throw new ServerStoreError('invalid_body', 'an empty body is refused', 400)
    }
    const stored: StoredObject = {
      value,
      sha256: await sha256Hex(value),
      createdAt: new Date().toISOString(),
    }
    // Unconditional overwrite, exactly like the service (no ETag, no CAS).
    this.objects.set(`${store}\u0000${name}`, stored)
    return {
      store,
      name,
      sha256: stored.sha256,
      size: byteLength(value),
      createdAt: stored.createdAt,
    }
  }

  async remove(store: string, name: string): Promise<void> {
    assertStoreName(store)
    assertObjectName(name)
    this.fail('DELETE', store, name)
    const key = `${store}\u0000${name}`
    if (!this.objects.has(key)) {
      throw new ServerStoreError(
        'not_found',
        `no object ${JSON.stringify(name)} in store ${JSON.stringify(store)}`,
        404,
      )
    }
    this.objects.delete(key)
  }

  async whoami(): Promise<StoreIdentity> {
    this.fail('GET', '/whoami')
    return structuredClone(this.identity)
  }

  /** Test seam: change what `whoami()` reports (e.g. after a key swap). */
  setIdentity(identity: StoreIdentity): void {
    this.identity = identity
  }
}

export function createMemoryTransport(options: MemoryTransportOptions): MemoryTransport {
  return new MemoryTransport(options)
}
