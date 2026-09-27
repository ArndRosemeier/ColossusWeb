/**
 * Shared test harness for the transport contract suite.
 *
 * One fake `fetch` serves BOTH the "HTTP implementation" and — by being the
 * thing the in-memory implementation does not need — documents the difference:
 * the HTTP transport is exercised through a real `Request`-shaped call and the
 * exact wire rules (header, URL, body) are readable from what it sent.
 */

import { createServerStoreTransport } from '../serverStore'
import { createMemoryTransport } from '../memoryTransport'
import { ServerStoreError } from '../transport'
import type { ServerStoreTransport, StoreIdentity } from '../transport'

/** A key with a shape nothing else in the app can produce by accident. */
export const TEST_KEY = 'ssk_testonly_0123456789abcdef_KEYMATERIAL'

export const TEST_STORE = 'colossus'

export const TEST_IDENTITY: StoreIdentity = {
  id: 'key_5e1a1d3f',
  label: 'tom',
  stores: ['colossus'],
  perms: ['read', 'write'],
}

export const WHOAMI_BODY = JSON.stringify({
  ...TEST_IDENTITY,
  expiresAt: null,
  lastUsedAt: null,
})

export interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
}

interface Stored {
  value: string
  sha256: string
  createdAt: string
}

function json(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}

function errorEnvelope(status: number, code: string, message: string): Response {
  return json(status, JSON.stringify({ error: { code, message } }))
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * A routing fake of the store: it enforces the key on every route, keeps a real
 * object map (so a PUT is visible to a later GET and overwrites like the real
 * unconditional PUT), and answers the service's envelope on every failure.
 *
 * `acceptedKeys` may be narrowed to make the key be refused.
 */
export class FakeStoreFetch {
  readonly calls: CapturedRequest[] = []
  readonly objects = new Map<string, Stored>()
  /** Fail the next call matching this `"<METHOD> <path>"` prefix, once. */
  scriptedFailure: { match: string; status: number; code: string; message: string } | null = null
  acceptedKeys: string[] = [TEST_KEY]
  /** Object GETs whose `x-serverstore-sha256` header is withheld. */
  withholdShaHeader = false

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    // Accept both a `Headers` instance (what the transport sends) and a plain
    // object (what a hand-written test sends), so the fake sees the SAME wire
    // bytes either way and a lost header cannot hide.
    const realHeaders: Record<string, string> = {}
    const provided = init?.headers
    if (provided instanceof Headers) {
      provided.forEach((value, name) => {
        realHeaders[name.toLowerCase()] = value
      })
    } else if (provided !== undefined) {
      for (const [name, value] of Object.entries(provided as Record<string, string>)) {
        realHeaders[name.toLowerCase()] = value
      }
    }
    const body = typeof init?.body === 'string' ? init.body : undefined
    this.calls.push({ url, method, headers: { ...realHeaders }, body })

    const path = new URL(url).pathname + new URL(url).search
    if (this.scriptedFailure && `${method} ${path}`.startsWith(this.scriptedFailure.match)) {
      const failure = this.scriptedFailure
      this.scriptedFailure = null
      return errorEnvelope(failure.status, failure.code, failure.message)
    }

    // The service checks the header it RECEIVED, not the one the test recorded,
    // so a transport that drops the header gets the same 401 a real caller would.
    const presented = realHeaders['authorization']
    if (presented === undefined) return errorEnvelope(401, 'unauthorized', 'no key presented')
    const raw = presented.startsWith('Bearer ') ? presented.slice('Bearer '.length) : null
    if (raw === null || !this.acceptedKeys.includes(raw)) {
      return errorEnvelope(401, 'unauthorized', 'key unknown, revoked or expired')
    }

    if (path === '/whoami') return json(200, WHOAMI_BODY)

    const match = /^\/stores\/([^/]+)\/objects(?:\/([^/?]+))?$/.exec(path)
    if (!match) return errorEnvelope(404, 'not_found', `no route ${path}`)
    const store = decodeURIComponent(match[1]!)
    const name = match[2] === undefined ? undefined : decodeURIComponent(match[2]!)
    const mapKey = `${store}\u0000${name ?? ''}`

    if (method === 'GET' && name === undefined) {
      const objects = [...this.objects.entries()]
        .filter(([key]) => key.startsWith(`${store}\u0000`))
        .map(([key, stored]) => ({
          store,
          name: key.split('\u0000')[1]!,
          sha256: stored.sha256,
          size: new TextEncoder().encode(stored.value).length,
          createdAt: stored.createdAt,
        }))
        .sort((a, b) => (a.name < b.name ? -1 : 1))
      return json(200, JSON.stringify({ objects }))
    }
    if (method === 'PUT' && name !== undefined) {
      if (body === undefined || body.length === 0) {
        return errorEnvelope(400, 'invalid_body', 'an empty body is refused')
      }
      const stored: Stored = { value: body, sha256: await digest(body), createdAt: '2026-09-28T00:00:00.000Z' }
      this.objects.set(mapKey, stored)
      return json(201, JSON.stringify({ store, name, sha256: stored.sha256, size: body.length, createdAt: stored.createdAt }))
    }
    if (method === 'GET' && name !== undefined) {
      const stored = this.objects.get(mapKey)
      if (!stored) {
        return errorEnvelope(404, 'not_found', `no object "${name}" in store "${store}"`)
      }
      const headers: Record<string, string> = { 'content-type': 'application/octet-stream' }
      if (!this.withholdShaHeader) headers['x-serverstore-sha256'] = stored.sha256
      return new Response(stored.value, { status: 200, headers })
    }
    if (method === 'DELETE' && name !== undefined) {
      if (!this.objects.has(mapKey)) {
        return errorEnvelope(404, 'not_found', `no object "${name}" in store "${store}"`)
      }
      this.objects.delete(mapKey)
      return new Response(null, { status: 204 })
    }
    return errorEnvelope(405, 'bad_response', `unexpected ${method} ${path}`)
  }

  /** Seed an object into the fake store, content-addressed like the real one. */
  async seed(store: string, name: string, value: string): Promise<void> {
    this.objects.set(`${store}\u0000${name}`, {
      value,
      sha256: await digest(value),
      createdAt: '2026-09-28T00:00:00.000Z',
    })
  }
}

export interface Arm {
  /** The label the shared suite prints; it names which implementation is under test. */
  name: string
  transport: ServerStoreTransport
  /**
   * Pre-place an object in the backing store, so `get`/`remove` have something
   * to find and an overwrite is detectable. Implemented for real on both arms.
   */
  seed: (name: string, value: string) => Promise<void>
  /** Every request the arm actually sent; [] for the in-memory arm (no wire). */
  requests: CapturedRequest[]
}

/** The HTTP arm: the real client, a stubbed `fetch` that routes like the service. */
export function httpArm(): Arm {
  const fake = new FakeStoreFetch()
  return {
    name: 'HTTP implementation (stubbed fetch)',
    transport: createServerStoreTransport('https://store.example.test', fake.fetch.bind(fake)),
    seed: (name, value) => fake.seed(TEST_STORE, name, value),
    requests: fake.calls,
  }
}

/** The in-memory arm: the same contract, no wire at all. */
export function memoryArm(): Arm {
  const transport = createMemoryTransport({ identity: structuredClone(TEST_IDENTITY) })
  return {
    name: 'in-memory fake',
    transport,
    seed: async (name, value) => {
      await transport.put(TEST_STORE, name, value)
    },
    requests: [],
  }
}

/** The error a transport is expected to throw for a scripted refusal. */
export function isServerStoreError(error: unknown, code: string): error is ServerStoreError {
  return error instanceof ServerStoreError && error.code === code
}

export function assertNever(value: never): never {
  throw new Error(`unexpected value ${String(value)}`)
}
