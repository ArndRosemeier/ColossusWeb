/**
 * The snapshot-protocol pins. Pure data, so they run with no transport at all.
 *
 * The statement under test is the design's whole reason: **the greatest name is
 * the newest state**, with no clock trust — including across a turn boundary and
 * at the 3-digit seq ceiling — and a race is a visible FORK, never a silently
 * resolved conflict.
 */

import { describe, expect, it } from 'vitest'
import { SAVE_VERSION, type SavedGameState } from '../../persistence/saveGame'
import {
  MAX_SNAPSHOT_SEQ,
  MAX_SNAPSHOT_TURN,
  SNAPSHOT_SCHEMA_VERSION,
  chooseSnapshot,
  detectFork,
  greatestSnapshotRef,
  longestSnapshotObjectName,
  newestSnapshotGroup,
  parseSnapshot,
  parseSnapshotObjectName,
  serializeSnapshot,
  snapshotNameBudget,
  snapshotObjectName,
  snapshotObjectPrefixFor,
  snapshotRefsForGame,
  type SnapshotBody,
} from '../snapshot'
import { OBJECT_NAME_MAX_LENGTH, gameObjectName, playerObjectName } from '../gameRecord'
import { assertObjectPrefix, type StoreObject } from '../transport'

const GAME = 'twin-1234abcd'
const TAG_A = 'key_5e1a'
const TAG_B = 'aaaa1111'

function makeBody(
  turn = 1,
  seq = 0,
  tag = TAG_A,
  parent: string | null = null,
  gameId = GAME,
): SnapshotBody {
  const name = snapshotObjectName(gameId, turn, seq, tag)
  return {
    header: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      name,
      gameId,
      turn,
      seq,
      writerTag: tag,
      seat: 0,
      parent,
      createdAt: '2026-09-28T10:00:00.000Z',
    },
    state: {
      version: SAVE_VERSION,
      savedAt: '2026-09-28T10:00:00.000Z',
      variantName: 'Default',
      state: { players: [], legions: [], phase: 'Split' } as unknown as SavedGameState,
    },
  }
}

function objectFor(name: string): StoreObject {
  return { store: 'colossus', name, sha256: 'x', size: 1, createdAt: '2026-09-28T10:00:00.000Z' }
}

describe('the name IS the ordering', () => {
  it('sorts names into state order, padded, across a turn boundary and at the seq ceiling', () => {
    const names = [
      snapshotObjectName(GAME, 1, 9, TAG_A),
      snapshotObjectName(GAME, 1, 10, TAG_A),
      snapshotObjectName(GAME, 1, 99, TAG_A),
      snapshotObjectName(GAME, 1, 100, TAG_A),
      snapshotObjectName(GAME, 1, 999, TAG_A),
      snapshotObjectName(GAME, 2, 0, TAG_A),
    ]
    expect([...names].sort()).toEqual(names)
    expect(names[0]).toContain('.0001.009.')
    expect(names[3]).toContain('.0001.100.')
    expect(newestSnapshotGroup(names.map((name) => parseSnapshotObjectName(name)!))[0]!.name).toBe(
      names[5],
    )
    expect(greatestSnapshotRef(names.map((name) => parseSnapshotObjectName(name)!))!.name).toBe(
      names[5],
    )
  })

  it('the longest legal name fits the service 64-character rule', () => {
    const longest = longestSnapshotObjectName()
    expect(longest.length).toBeLessThanOrEqual(OBJECT_NAME_MAX_LENGTH)
    // snap. + 32 + . + 4 + . + 3 + . + 8 = 55
    expect(snapshotNameBudget()).toBe(55)
    expect(longest).toContain(`.${MAX_SNAPSHOT_TURN}.${MAX_SNAPSHOT_SEQ}.`)
  })

  it('refuses a turn or seq whose padding would sort out of order', () => {
    expect(() => snapshotObjectName(GAME, MAX_SNAPSHOT_TURN + 1, 0, TAG_A)).toThrow(
      /zero-padded snapshot name would sort out of order/,
    )
    expect(() => snapshotObjectName(GAME, 1, MAX_SNAPSHOT_SEQ + 1, TAG_A)).toThrow(
      /zero-padded snapshot name would sort out of order/,
    )
    expect(() => snapshotObjectName(GAME, -1, 0, TAG_A)).toThrow(/snapshot turn must be an integer/)
  })

  it('parses a name back into its fields and ignores everything that is not a snapshot', () => {
    const name = snapshotObjectName(GAME, 12, 7, TAG_A)
    expect(parseSnapshotObjectName(name)).toEqual({
      name,
      gameId: GAME,
      turn: 12,
      seq: 7,
      tag: TAG_A,
    })
    expect(parseSnapshotObjectName(`game.${GAME}`)).toBeNull()
    expect(parseSnapshotObjectName(`player.${GAME}.${TAG_A}`)).toBeNull()
    expect(parseSnapshotObjectName(`snap.${GAME}.00001.000.${TAG_A}`)).toBeNull()
    expect(parseSnapshotObjectName(`snap.${GAME}.0001.000.short`)).toBeNull()
    // The OLD scheme is not a snapshot either, so a stale object is inert.
    expect(parseSnapshotObjectName(`g.${GAME}.s.0001.000.${TAG_A}`)).toBeNull()
  })

  it("filters an object list to ONE game's snapshots", () => {
    const objects = [
      objectFor(gameObjectName(GAME)),
      objectFor(playerObjectName(GAME, TAG_A)),
      objectFor(snapshotObjectName(GAME, 1, 0, TAG_A)),
      objectFor(snapshotObjectName('other-1111aaaa', 1, 0, TAG_A)),
      objectFor('random.object'),
    ]
    expect(snapshotRefsForGame(objects, GAME).map((ref) => ref.name)).toEqual([
      snapshotObjectName(GAME, 1, 0, TAG_A),
    ])
  })

  it("names ONE game's sync with its prefix, and nothing else", () => {
    const prefix = snapshotObjectPrefixFor(GAME)
    expect(prefix).toBe(`snap.${GAME}.`)
    const mine = snapshotObjectName(GAME, 3, 1, TAG_A)
    const otherGame = snapshotObjectName('other-1111aaaa', 3, 1, TAG_A)
    const otherKind = playerObjectName(GAME, TAG_A)
    expect(mine.startsWith(prefix)).toBe(true)
    expect(otherGame.startsWith(prefix)).toBe(false)
    expect(otherKind.startsWith(prefix)).toBe(false)
    // A game id that merely STARTS WITH this one is not this game.
    expect(snapshotObjectName(`${GAME}-2`, 1, 0, TAG_A).startsWith(prefix)).toBe(false)
    // The prefix is legal for the store (it answers 400 for an illegal one).
    expect(() => assertObjectPrefix(prefix)).not.toThrow()
  })
})

describe('the body is validated at the boundary, LOUDLY', () => {
  it('round-trips through its own serialiser', () => {
    const body = makeBody(3, 4, TAG_B, snapshotObjectName(GAME, 3, 3, TAG_A))
    expect(parseSnapshot(serializeSnapshot(body))).toEqual(body)
  })

  it('refuses a body that does not parse, or that lies about itself', () => {
    const body = makeBody()
    const cases: Array<[string, RegExp]> = [
      ['not json', /is not JSON/],
      ['[]', /is not a JSON object/],
      ['{}', /header is not a JSON object/],
      [JSON.stringify({ ...body, header: { ...body.header, schemaVersion: 99 } }), /schema version 99/],
      [JSON.stringify({ ...body, header: { ...body.header, gameId: 'UPPER' } }), /illegal game id/],
      [JSON.stringify({ ...body, header: { ...body.header, turn: 10000 } }), /turn must be an integer/],
      [JSON.stringify({ ...body, header: { ...body.header, seq: 1000 } }), /seq must be an integer/],
      [JSON.stringify({ ...body, header: { ...body.header, writerTag: 'short' } }), /writer tag/],
      [JSON.stringify({ ...body, header: { ...body.header, parent: 'not-a-name' } }), /not a snapshot of this game/],
      [
        JSON.stringify({ ...body, header: { ...body.header, name: snapshotObjectName(GAME, 9, 9, TAG_A) } }),
        /was not built from its own/,
      ],
      [JSON.stringify({ ...body, state: undefined }), /state is not a JSON object/],
      [JSON.stringify({ ...body, state: { ...body.state, version: 99 } }), /save version 99/],
      [JSON.stringify({ ...body, state: { ...body.state, variantName: '' } }), /variantName must be a non-empty/],
      [JSON.stringify({ ...body, state: { ...body.state, state: null } }), /must be the game state object/],
    ]
    for (const [text, message] of cases) {
      expect(() => parseSnapshot(text), text).toThrow(message)
    }
  })

  it('carries no key-shaped field at all', () => {
    const parsed = parseSnapshot(serializeSnapshot(makeBody())) as unknown as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(['header', 'state'])
    const header = parsed['header'] as Record<string, unknown>
    expect(Object.keys(header)).not.toContain('key')
    expect(Object.keys(header)).not.toContain('secret')
    expect(JSON.stringify(parsed)).not.toContain('ssk_')
  })
})

describe('a fork is DETECTED and chosen deterministically, never resolved silently', () => {
  it('two writers at the same (turn, seq) are one fork with two names', () => {
    const a = parseSnapshotObjectName(snapshotObjectName(GAME, 5, 2, TAG_A))!
    const b = parseSnapshotObjectName(snapshotObjectName(GAME, 5, 2, TAG_B))!
    const fork = detectFork([a, b])
    expect(fork).not.toBeNull()
    expect(fork!.turn).toBe(5)
    expect(fork!.seq).toBe(2)
    expect(fork!.names).toHaveLength(2)
    expect(new Set(fork!.names).size).toBe(2)
    expect(detectFork([a])).toBeNull()
  })

  it('picks the snapshot continuing what we hold, else the LOWEST tag', () => {
    const parent = snapshotObjectName(GAME, 4, 9, TAG_A)
    const a = parseSnapshotObjectName(snapshotObjectName(GAME, 5, 0, TAG_A))!
    const b = parseSnapshotObjectName(snapshotObjectName(GAME, 5, 0, TAG_B))!
    const candidates = [
      { ref: a, parent },
      { ref: b, parent: null },
    ]
    expect(chooseSnapshot(candidates, parent).ref.tag).toBe(TAG_A)
    expect(chooseSnapshot(candidates, null).ref.tag).toBe(TAG_B)
    expect(
      chooseSnapshot(candidates, snapshotObjectName('other-1111aaaa', 1, 0, TAG_A)).ref.tag,
    ).toBe(TAG_B)
  })
})
