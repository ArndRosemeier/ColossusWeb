/**
 * The transport CONTRACT — one suite, run against BOTH implementations.
 *
 * Every assertion below is written against the `ServerStoreTransport`
 * interface, so the HTTP client and the in-memory fake are held to the same
 * rules by construction. If they ever drift, this file fails — which is the
 * point of the pin "one contract, two implementations".
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { installKey, forgetKey } from '../keyStore'
import {
  TEST_KEY,
  TEST_STORE,
  httpArm,
  memoryArm,
  type Arm,
} from './transportHarness'

const ARMS: Array<[string, () => Arm]> = [
  ['HTTP implementation (stubbed fetch)', httpArm],
  ['in-memory fake', memoryArm],
]

/** The names a listing holds, in the order the store reported them. */
function namesOf(objects: ReadonlyArray<{ name: string }>): string[] {
  return objects.map((object) => object.name)
}

describe.each(ARMS)('%s', (_name, makeArm) => {
  let arm: Arm

  beforeEach(() => {
    arm = makeArm()
    forgetKey()
    installKey(TEST_KEY)
  })

  it('lists the objects in a store as plain data', async () => {
    await arm.seed('host.game', '{"name":"Thursday"}')
    const objects = await arm.transport.list(TEST_STORE)
    expect(objects.map((o) => o.name)).toEqual(['host.game'])
    const [object] = objects
    expect(object!.store).toBe(TEST_STORE)
    expect(object!.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(object!.size).toBeGreaterThan(0)
    expect(typeof object!.createdAt).toBe('string')
  })

  it('gets an object back byte-for-byte and reports the service sha256', async () => {
    await arm.seed('host.game', '{"name":"Thursday"}')
    const result = await arm.transport.get(TEST_STORE, 'host.game')
    expect(result.value).toBe('{"name":"Thursday"}')
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('puts an object and the following GET returns exactly those bytes', async () => {
    const put = await arm.transport.put(TEST_STORE, 'g.abc.p.key1', '{"seat":1}')
    expect(put.store).toBe(TEST_STORE)
    expect(put.name).toBe('g.abc.p.key1')
    expect(put.size).toBe('{"seat":1}'.length)
    const got = await arm.transport.get(TEST_STORE, 'g.abc.p.key1')
    expect(got.value).toBe('{"seat":1}')
  })

  it('overwrites unconditionally — a second PUT is the new truth', async () => {
    await arm.transport.put(TEST_STORE, 'g.abc.game', '{"status":"open"}')
    await arm.transport.put(TEST_STORE, 'g.abc.game', '{"status":"started"}')
    const got = await arm.transport.get(TEST_STORE, 'g.abc.game')
    expect(got.value).toBe('{"status":"started"}')
  })

  it('removes an object so it is gone from the list and from get', async () => {
    await arm.seed('g.abc.p.key1', '{"seat":1}')
    await arm.transport.remove(TEST_STORE, 'g.abc.p.key1')
    expect((await arm.transport.list(TEST_STORE)).map((o) => o.name)).not.toContain('g.abc.p.key1')
    await expect(arm.transport.get(TEST_STORE, 'g.abc.p.key1')).rejects.toThrow()
  })

  it('surfaces a failure envelope with its code AND its message, never silently', async () => {
    let caught: unknown
    try {
      await arm.transport.get(TEST_STORE, 'nobody.here')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    const failure = caught as { code?: unknown; message?: unknown }
    expect(typeof failure.code).toBe('string')
    expect(failure.code).not.toBe('')
    expect(typeof failure.message).toBe('string')
    expect(failure.message).not.toBe('')
    // The caller can BRANCH on the code: a missing object is `not_found`.
    expect(failure.code).toBe('not_found')
  })

  it('refuses an illegal object name locally, before any request is made', async () => {
    const before = arm.requests.length
    await expect(arm.transport.put(TEST_STORE, 'Bad/Name', '{}')).rejects.toThrow(
      /illegal object name/,
    )
    await expect(arm.transport.get(TEST_STORE, 'UPPER')).rejects.toThrow(/illegal object name/)
    await expect(arm.transport.remove(TEST_STORE, '')).rejects.toThrow(/illegal object name/)
    await expect(arm.transport.put(TEST_STORE, 'a'.repeat(65), '{}')).rejects.toThrow(
      /illegal object name/,
    )
    // Not one byte crossed the wire for any of the four.
    expect(arm.requests.length).toBe(before)
  })

  it('reports the identity whoami returns, and never any key material', async () => {
    const identity = await arm.transport.whoami()
    expect(identity.id).toBe('key_5e1a1d3f')
    expect(identity.label).toBe('tom')
    expect(identity.stores).toEqual(['colossus'])
    expect(identity.perms).toEqual(['read', 'write'])
    const serialized = JSON.stringify(identity)
    expect(serialized).not.toContain(TEST_KEY)
    expect(serialized).not.toContain('ssk_')
  })

  it('filters the list by prefix: exactly the names that start with it', async () => {
    await arm.seed('game.alpha', '{"kind":"game"}')
    await arm.seed('game.beta', '{"kind":"game"}')
    await arm.seed('player.alpha.key_5e1a', '{"kind":"player"}')
    await arm.seed('player.beta.key_5e1a', '{"kind":"player"}')
    await arm.seed('snap.alpha.0001.000.key_5e1a', '{"kind":"snapshot"}')
    await arm.seed('random.object', '{"kind":"other"}')

    // The lobby's list.
    expect(namesOf(await arm.transport.list(TEST_STORE, 'game.'))).toEqual(['game.alpha', 'game.beta'])
    // One game's participants — and the trailing dot keeps `alpha` off `alpha-2`.
    await arm.seed('player.alpha-2.key_5e1a', '{"kind":"player"}')
    expect(namesOf(await arm.transport.list(TEST_STORE, 'player.alpha.'))).toEqual([
      'player.alpha.key_5e1a',
    ])
    // One game's sync.
    expect(namesOf(await arm.transport.list(TEST_STORE, 'snap.alpha.'))).toEqual([
      'snap.alpha.0001.000.key_5e1a',
    ])
    // Omitted: the whole store, exactly as before the filter existed.
    expect(namesOf(await arm.transport.list(TEST_STORE))).toHaveLength(7)
    // A prefix matching nothing is an EMPTY LIST, never an error.
    expect(await arm.transport.list(TEST_STORE, 'zzz')).toEqual([])
  })

  it('refuses an illegal prefix locally, before any request is made', async () => {
    await arm.seed('game.alpha', '{}')
    const before = arm.requests.length
    // The service answers `400 invalid_name` for these; a client that could not
    // tell that from "no matches" would render an empty lobby as a healthy one.
    await expect(arm.transport.list(TEST_STORE, 'GAME.')).rejects.toThrow(/illegal object prefix/)
    await expect(arm.transport.list(TEST_STORE, '')).rejects.toThrow(/illegal object prefix/)
    await expect(arm.transport.list(TEST_STORE, '-lead')).rejects.toThrow(/illegal object prefix/)
    await expect(arm.transport.list(TEST_STORE, 'a'.repeat(65))).rejects.toThrow(
      /illegal object prefix/,
    )
    expect(arm.requests.length).toBe(before)
  })

  it('lists an old-scheme g.* object without ever calling it a game', async () => {
    // The live store holds three orphaned `g.*` objects from the owner's test
    // game. They are deliberately NOT migrated and NOT deleted; the client must
    // simply never treat one as a game.
    await arm.seed('g.abc.game', '{"version":1}')
    await arm.seed('g.abc.p.key_5e1a', '{"version":1}')
    await arm.seed('g.abc.s.0001.000.key_5e1a', '{"version":1}')
    await arm.seed('game.real-1111aaaa', '{"kind":"game"}')
    expect(namesOf(await arm.transport.list(TEST_STORE, 'game.'))).toEqual(['game.real-1111aaaa'])
    expect(namesOf(await arm.transport.list(TEST_STORE, 'player.'))).toEqual([])
    expect(namesOf(await arm.transport.list(TEST_STORE, 'snap.'))).toEqual([])
    // ...and they are still there, untouched: ignoring is not deleting.
    expect(namesOf(await arm.transport.list(TEST_STORE))).toHaveLength(4)
  })
})
