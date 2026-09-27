/**
 * What is specific to the in-memory fake, beyond the shared contract suite:
 * that its `sha256`/`size` really describe the bytes (so a later slice can use
 * them for change detection exactly as it would against the service), and that
 * it keeps the service's awkward edges rather than smoothing them over.
 */

import { describe, expect, it } from 'vitest'
import { createMemoryTransport } from '../memoryTransport'
import { ServerStoreError } from '../transport'
import { TEST_IDENTITY, TEST_STORE } from './transportHarness'

function makeTransport() {
  return createMemoryTransport({ identity: structuredClone(TEST_IDENTITY) })
}

async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('memoryTransport', () => {
  it('names an object with the same sha256 the web crypto API computes', async () => {
    const transport = makeTransport()
    const value = '{"player":"tom","legions":[]}'
    const put = await transport.put(TEST_STORE, 'g.abc.p.key1', value)
    expect(put.sha256).toBe(await sha256Hex(value))
    expect(put.size).toBe(new TextEncoder().encode(value).length)
    expect((await transport.get(TEST_STORE, 'g.abc.p.key1')).sha256).toBe(put.sha256)
  })

  it('changes the sha256 when the bytes change', async () => {
    const transport = makeTransport()
    const first = await transport.put(TEST_STORE, 'g.abc.game', '{"status":"open"}')
    const second = await transport.put(TEST_STORE, 'g.abc.game', '{"status":"started"}')
    expect(second.sha256).not.toBe(first.sha256)
  })

  it('measures size in UTF-8 bytes, not in JS characters', async () => {
    const transport = makeTransport()
    const value = '{"name":"Ægir — ünïcode"}'
    const put = await transport.put(TEST_STORE, 'g.abc.game', value)
    expect(put.size).toBe(new TextEncoder().encode(value).length)
    expect(put.size).toBeGreaterThan(value.length - 4)
  })

  it('keeps the store namespace flat and separated', async () => {
    const transport = makeTransport()
    await transport.put('colossus', 'g.abc.game', '{"a":1}')
    await transport.put('colossus-other', 'g.abc.game', '{"b":2}')
    expect((await transport.list('colossus')).map((o) => o.name)).toEqual(['g.abc.game'])
    expect((await transport.get('colossus-other', 'g.abc.game')).value).toBe('{"b":2}')
  })

  it('lists objects in name order, which is how "newest" is meant to be a max', async () => {
    const transport = makeTransport()
    await transport.put(TEST_STORE, 'g.abc.s.0002.0001.key1', '{}')
    await transport.put(TEST_STORE, 'g.abc.s.0001.0001.key1', '{}')
    await transport.put(TEST_STORE, 'g.abc.s.0001.0002.key1', '{}')
    expect((await transport.list(TEST_STORE)).map((o) => o.name)).toEqual([
      'g.abc.s.0001.0001.key1',
      'g.abc.s.0001.0002.key1',
      'g.abc.s.0002.0001.key1',
    ])
  })

  it('refuses an empty body, exactly as the service does', async () => {
    const transport = makeTransport()
    let caught: unknown
    try {
      await transport.put(TEST_STORE, 'g.abc.game', '')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ServerStoreError)
    expect((caught as ServerStoreError).code).toBe('invalid_body')
  })

  it('answers not_found for a DELETE of a name that is not there', async () => {
    const transport = makeTransport()
    let caught: unknown
    try {
      await transport.remove(TEST_STORE, 'nobody.here')
    } catch (error) {
      caught = error
    }
    expect((caught as ServerStoreError).code).toBe('not_found')
  })
})
