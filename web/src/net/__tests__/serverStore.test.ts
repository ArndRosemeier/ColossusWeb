/**
 * The rules that belong to the HTTP implementation specifically: where the key
 * is allowed to travel, what the client sends, and what it refuses to accept as
 * a response.
 *
 * The PIN "the key travels only in the Authorization header" lives here — it is
 * asserted over the requests the transport actually made, not over its source.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { forgetKey, installKey } from '../keyStore'
import { createServerStoreTransport, parseWhoami, serverStoreBaseUrl } from '../serverStore'
import { ServerStoreError } from '../transport'
import { FakeStoreFetch, TEST_KEY, TEST_STORE } from './transportHarness'

function makeTransport(fake: FakeStoreFetch) {
  return createServerStoreTransport('https://store.example.test', fake.fetch.bind(fake))
}

describe('serverStore HTTP transport', () => {
  let fake: FakeStoreFetch

  beforeEach(() => {
    fake = new FakeStoreFetch()
    forgetKey()
    installKey(TEST_KEY)
  })

  it('sends the key in the Authorization header and NOWHERE else', async () => {
    const transport = makeTransport(fake)
    await fake.seed(TEST_STORE, 'host.game', '{"name":"Thursday"}')

    await transport.whoami()
    await transport.list(TEST_STORE)
    await transport.get(TEST_STORE, 'host.game')
    await transport.put(TEST_STORE, 'g.abc.p.key1', '{"seat":1}')
    await transport.remove(TEST_STORE, 'g.abc.p.key1')

    expect(fake.calls).toHaveLength(5)
    for (const call of fake.calls) {
      // The header is the ONE carrier …
      expect(call.headers['authorization']).toBe(`Bearer ${TEST_KEY}`)
      // … and no other carrier exists: no query string, no path segment, no body.
      expect(call.url.toLowerCase()).not.toContain(TEST_KEY.toLowerCase())
      expect(new URL(call.url).search).toBe('')
      expect(call.body ?? '').not.toContain(TEST_KEY)
      for (const [name, value] of Object.entries(call.headers)) {
        if (name === 'authorization') continue
        expect(value).not.toContain(TEST_KEY)
      }
    }
  })

  it('stops being accepted the moment the header is not the one it sent', async () => {
    // The fake refuses what it RECEIVED, so a transport that built the header
    // and then lost it is caught here rather than only by reading the request.
    const transport = createServerStoreTransport('https://store.example.test', (input, init) => {
      const headers = new Headers(init?.headers)
      headers.delete('authorization')
      return fake.fetch(input as RequestInfo, { ...init, headers })
    })
    let caught: unknown
    try {
      await transport.whoami()
    } catch (error) {
      caught = error
    }
    expect((caught as ServerStoreError).code).toBe('unauthorized')
  })

  it('surfaces the x-serverstore-sha256 response header on a GET', async () => {    const transport = makeTransport(fake)
    await fake.seed(TEST_STORE, 'host.game', '{"name":"Thursday"}')
    const result = await transport.get(TEST_STORE, 'host.game')
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reports a missing sha header as null rather than inventing one', async () => {
    fake.withholdShaHeader = true
    const transport = makeTransport(fake)
    await fake.seed(TEST_STORE, 'host.game', '{"name":"Thursday"}')
    const result = await transport.get(TEST_STORE, 'host.game')
    expect(result.sha256).toBeNull()
  })

  it('rethrows the service error code and message verbatim', async () => {
    const transport = makeTransport(fake)
    fake.scriptedFailure = {
      match: 'GET /stores/colossus/objects',
      status: 403,
      code: 'forbidden',
      message: 'this key may not read store "colossus"',
    }
    let caught: unknown
    try {
      await transport.list(TEST_STORE)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ServerStoreError)
    const failure = caught as ServerStoreError
    expect(failure.code).toBe('forbidden')
    expect(failure.message).toBe('this key may not read store "colossus"')
    expect(failure.status).toBe(403)
  })

  it('reports a transport failure loudly instead of returning empty data', async () => {
    const transport = createServerStoreTransport('https://store.example.test', () => {
      throw new TypeError('Failed to fetch')
    })
    let caught: unknown
    try {
      await transport.list(TEST_STORE)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ServerStoreError)
    expect((caught as ServerStoreError).code).toBe('transport_error')
    expect((caught as ServerStoreError).message).toMatch(/Failed to fetch/)
  })

  it('refuses a whoami body that is not the identity shape', () => {
    expect(() => parseWhoami('{"id":"k","label":"tom"}')).toThrow(/stores is not a string\[\]/)
    expect(() => parseWhoami('not json')).toThrow(/not JSON/)
  })

  it('builds the URL from the configured base, not a hard-coded one', async () => {
    const other = new FakeStoreFetch()
    const transport = createServerStoreTransport('https://other.example.test/', other.fetch.bind(other))
    await transport.whoami()
    expect(other.calls[0]!.url).toBe('https://other.example.test/whoami')
  })

  it('defaults to the documented base URL when nothing overrides it', () => {
    // The default lives in ONE place (`serverStoreBaseUrl`) and the env override
    // is its only other branch; the build reads the same name.
    expect(serverStoreBaseUrl()).toBe('https://store.futuremagic.de')
  })

  it('refuses to call the store with no key loaded', async () => {
    const transport = makeTransport(fake)
    forgetKey()
    await expect(transport.whoami()).rejects.toThrow(/no ServerStore key is loaded/)
    await expect(transport.list(TEST_STORE)).rejects.toThrow(/no ServerStore key is loaded/)
    expect(fake.calls).toHaveLength(0)
  })

  it('an authenticated call WITHOUT the Bearer header is refused by the store', async () => {
    // The other half of the pin: not only "is the header there?" but "does the
    // credential have to be in it?". The fake checks what it RECEIVED, so it
    // stands in for the service's key guard.
    const transport = createServerStoreTransport('https://store.example.test', (input, init) => {
      const headers = new Headers(init?.headers)
      headers.delete('authorization')
      return fake.fetch(input as RequestInfo, { ...init, headers })
    })
    await expect(transport.list(TEST_STORE)).rejects.toThrow(/no key presented/)
  })

  it('calls fetch with a receiver the platform accepts, never the transport itself', async () => {
    // A REAL browser refuses `fetch` invoked as a method of anything but the global:
    //   Failed to execute 'fetch' on 'Window': Illegal invocation
    // That is exactly what a browser did the first time a real key was entered, and no
    // test could see it because every other stub here is receiver-insensitive — the
    // transport held `window.fetch` on an instance and called it as `this.fetchImpl(...)`.
    // This stub ENFORCES the platform's rule, so the defect cannot come back.
    const receivers: unknown[] = []
    const strictFetch = function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      receivers.push(this)
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
      }
      return fake.fetch(input as RequestInfo, init)
    } as unknown as typeof fetch

    const transport = createServerStoreTransport('https://store.example.test', strictFetch)
    await expect(transport.whoami()).resolves.toBeDefined()

    expect(receivers).toHaveLength(1)
    expect(receivers[0]).not.toBe(transport)
  })
})
