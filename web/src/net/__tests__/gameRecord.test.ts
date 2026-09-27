/**
 * The game-record pins: the object NAME is legal whatever the display name is,
 * two games never share an id, and a body that does not parse is LOUD.
 *
 * The naming half is pure data, so it is checked here without any transport; the
 * behaviour of the lobby OPERATIONS is in `lobby.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import {
  GAME_ID_SUFFIX_LENGTH,
  GAME_RECORD_VERSION,
  MAX_GAME_ID_LENGTH,
  OBJECT_NAME_MAX_LENGTH,
  PLAYER_RECORD_VERSION,
  assertGameId,
  gameIdFor,
  gameObjectName,
  parseGameObjectName,
  parseGameObjectRecord,
  parseGameRecord,
  parsePlayerObjectName,
  parsePlayerRecord,
  playerObjectName,
  playerTagFor,
  seatIndexOf,
  seatOrderFor,
  serializeGameRecord,
  serializePlayerRecord,
  slugifyDisplayName,
  type GameRecord,
  type PlayerRecord,
} from '../gameRecord'
import { OBJECT_NAME_PATTERN, assertObjectName } from '../transport'

/** The service's own rule, asserted the way the service asserts it. */
function expectLegalObjectName(name: string): void {
  expect(OBJECT_NAME_PATTERN.test(name)).toBe(true)
  expect(name.length).toBeLessThanOrEqual(OBJECT_NAME_MAX_LENGTH)
  expect(() => assertObjectName(name)).not.toThrow()
}

const HOSTILE_DISPLAY_NAMES = [
  "Tom's Game!",
  '  spaced   out  ',
  'ALLCAPS',
  'Ünïcödé 🎲 déjà-vu',
  '!!!???',
  'a',
  'x'.repeat(500),
  'a very long name '.repeat(400),
  '../etc/passwd',
  'g.abc.game',
]

describe('game ids and object names', () => {
  it('gives a legal name for BOTH object kinds whatever the display name is', () => {
    for (const displayName of HOSTILE_DISPLAY_NAMES) {
      const gameId = gameIdFor(displayName)
      expect(gameId.length).toBeLessThanOrEqual(MAX_GAME_ID_LENGTH)
      expectLegalObjectName(gameObjectName(gameId))
      expectLegalObjectName(playerObjectName(gameId, playerTagFor('key_5e1a1d3f')))
    }
  })

  it('the LONGEST legal display name still names both objects legally', () => {
    // There is no cap on the display name — it lives in the body. A 5000-character
    // name is truncated into the slug and must not push either object over 64.
    const longest = 'W'.repeat(5000)
    const gameId = gameIdFor(longest)
    expect(gameId.length).toBe(MAX_GAME_ID_LENGTH)
    const gameName = gameObjectName(gameId)
    const playerName = playerObjectName(gameId, playerTagFor('Zz9_-_aBcDeF'))
    expectLegalObjectName(gameName)
    expectLegalObjectName(playerName)
    // ...and there is headroom left for a longer tag later.
    expect(playerName.length).toBeLessThan(OBJECT_NAME_MAX_LENGTH - 10)
  })

  it('keeps a readable slug and spends the rest on the random suffix', () => {
    expect(slugifyDisplayName("Tom's Game!")).toBe('tom-s-game')
    expect(slugifyDisplayName('!!!')).toBe('game')
    const gameId = gameIdFor("Tom's Game!")
    expect(gameId).toMatch(/^tom-s-game-[0-9a-f]{8}$/)
    expect(gameId.length).toBe('tom-s-game'.length + 1 + GAME_ID_SUFFIX_LENGTH)
  })

  it('two games from the same display name get DIFFERENT ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => gameIdFor('Twin Game')))
    expect(ids.size).toBe(50)
  })

  it('refuses a suffix that could produce an illegal name', () => {
    expect(() => gameIdFor('Twin', 'NOT HEX')).toThrow(/not lowercase alphanumeric/)
  })

  it('parses a game object name and ignores everything else', () => {
    expect(parseGameObjectName('g.twin-1234abcd.game')).toBe('twin-1234abcd')
    // A player object is NEVER a game, even when its tag is literally "game".
    expect(parseGameObjectName('g.abc.p.game')).toBeNull()
    expect(parseGameObjectName('g.abc.p.key_5e1a')).toBeNull()
    expect(parseGameObjectName('random.object')).toBeNull()
    expect(parseGameObjectName('games.abc.game')).toBeNull()
    expect(parseGameObjectName('g.abc.game.bak')).toBeNull()
  })

  it('parses a player object name into its game id and tag', () => {
    expect(parsePlayerObjectName('g.abc.p.key_5e1a')).toEqual({
      gameId: 'abc',
      tag: 'key_5e1a',
    })
    expect(parsePlayerObjectName('g.abc.game')).toBeNull()
  })

  it('derives the tag from the first 8 lowercased characters of the full id', () => {
    expect(playerTagFor('key_5e1a1d3f')).toBe('key_5e1a')
    expect(playerTagFor('  KEY_5E1A1D3F  ')).toBe('key_5e1a')
    expect(playerTagFor('xy9_zZ12AbCd')).toBe('xy9_zz12')
    // A backstop that must never fire for a real id: too short, or illegal chars.
    expect(() => playerTagFor('short')).toThrow(/cannot yield a legal 8-character player tag/)
    expect(() => playerTagFor('bad+id/with=chars')).toThrow(/cannot yield a legal/)
  })

  it('assertGameId refuses an id that would overflow the name budget', () => {
    expect(() => assertGameId('a'.repeat(MAX_GAME_ID_LENGTH + 1))).toThrow(/illegal game id/)
    expect(() => assertGameId('Upper')).toThrow(/illegal game id/)
  })
})

describe('game records', () => {
  function player(playerId: string, label: string): PlayerRecord {
    return {
      version: PLAYER_RECORD_VERSION,
      gameId: 'twin-1234abcd',
      playerId,
      label,
      joinedAt: '2026-09-28T10:01:00.000Z',
    }
  }

  const record: GameRecord = {
    version: GAME_RECORD_VERSION,
    gameId: 'twin-1234abcd',
    displayName: "Tom's Game!",
    variant: 'Default',
    creator: { id: 'key_5e1a1d3f', label: 'tom' },
    status: 'lobby',
    maxPlayers: 6,
    seatOrder: [],
    createdAt: '2026-09-28T10:00:00.000Z',
  }

  it('round-trips through its own serialiser, keeping the full display name', () => {
    expect(parseGameRecord(serializeGameRecord(record))).toEqual(record)
    const long = { ...record, displayName: 'W'.repeat(500) }
    expect(parseGameRecord(serializeGameRecord(long)).displayName).toHaveLength(500)
  })

  it('refuses a malformed game body LOUDLY, naming what was wrong', () => {
    const cases: Array<[string, RegExp]> = [
      ['not json', /is not JSON/],
      ['[]', /is not a JSON object/],
      ['{}', /version must be an integer/],
      [JSON.stringify({ ...record, version: 99 }), /schema version 99/],
      [JSON.stringify({ ...record, gameId: 'UPPER' }), /illegal game id/],
      [JSON.stringify({ ...record, status: 'paused' }), /want one of lobby, started/],
      [JSON.stringify({ ...record, maxPlayers: 1 }), /integer >= 2/],
      [JSON.stringify({ ...record, createdAt: 'yesterday' }), /is not a date/],
      [JSON.stringify({ ...record, displayName: '' }), /displayName must be a non-empty string/],
      [JSON.stringify({ ...record, creator: { id: 'x' } }), /creator\.label must be a non-empty/],
      [JSON.stringify({ ...record, creator: [] }), /creator must be an object/],
      // `seatOrder` is written at Start. A v2 record without it, or one that
      // seats a player twice, is refused rather than guessed at.
      [JSON.stringify({ ...record, seatOrder: undefined }), /seatOrder must be an array/],
      [JSON.stringify({ ...record, seatOrder: ['a', 'a'] }), /same player in two seats/],
      [JSON.stringify({ ...record, seatOrder: [''] }), /non-string or empty seat/],
      [JSON.stringify({ ...record, seatOrder: ['key_5e1a1d3f'] }), /must have no seats/],
      [
        JSON.stringify({ ...record, status: 'started' }),
        /is started with 0 seat\(s\); a playable game needs at least 2/,
      ],
    ]
    for (const [body, message] of cases) {
      expect(() => parseGameRecord(body), body).toThrow(message)
      try {
        parseGameRecord(body)
      } catch (error) {
        expect((error as { code?: string }).code, body).toMatch(
          /^(bad_game_record|unsupported_record_version)$/,
        )
      }
    }
  })

  it('refuses a body whose gameId disagrees with the object name', () => {
    expect(() =>
      parseGameObjectRecord('g.other-9999ffff.game', serializeGameRecord(record)),
    ).toThrow(/the name and the body disagree/)
  })

  it('round-trips a player record and refuses a malformed one', () => {
    const player = {
      version: PLAYER_RECORD_VERSION,
      gameId: 'twin-1234abcd',
      playerId: 'key_5e1a1d3f',
      label: 'tom',
      joinedAt: '2026-09-28T10:01:00.000Z',
    }
    expect(parsePlayerRecord(serializePlayerRecord(player))).toEqual(player)
    expect(() => parsePlayerRecord('{}')).toThrow(/version must be an integer/)
    expect(() => parsePlayerRecord(JSON.stringify({ ...player, version: 2 }))).toThrow(
      /unsupported_record_version|schema version 2/,
    )
    expect(() => parsePlayerRecord(JSON.stringify({ ...player, joinedAt: 'never' }))).toThrow(
      /is not a date/,
    )
    expect(() => parsePlayerRecord(JSON.stringify({ ...player, playerId: '' }))).toThrow(
      /playerId must be a non-empty string/,
    )
  })

  it('a version-1 record is refused as unsupported, never guessed into seats', () => {
    const { seatOrder: _seats, ...v1 } = record
    expect(() => parseGameRecord(JSON.stringify({ ...v1, version: 1 }))).toThrow(
      /schema version 1/,
    )
  })

  it('seatOrderFor puts the creator first, then everyone else by tag, deterministically', () => {
    const players = [
      player('AAAAbbbb1111', 'bob'),
      player('key_5e1a1d3f', 'tom'),
      player('CCCCdddd2222', 'carol'),
    ]
    // Tags: aaaabbbb, key_5e1a, ccccdddd → bob, tom, carol; creator tom moves to seat 0.
    expect(seatOrderFor('key_5e1a1d3f', players)).toEqual([
      'key_5e1a1d3f',
      'AAAAbbbb1111',
      'CCCCdddd2222',
    ])
    // Order of the input must not matter — the same store yields the same seats.
    expect(seatOrderFor('key_5e1a1d3f', [...players].reverse())).toEqual(
      seatOrderFor('key_5e1a1d3f', players),
    )
  })

  it('seatIndexOf reports a spectator as -1, never as seat 0', () => {
    const started: GameRecord = {
      ...record,
      status: 'started',
      seatOrder: ['key_5e1a1d3f', 'AAAAbbbb1111'],
    }
    expect(seatIndexOf(started, 'AAAAbbbb1111')).toBe(1)
    expect(seatIndexOf(started, 'key_5e1a1d3f')).toBe(0)
    expect(seatIndexOf(started, 'ZZZZ9999watching')).toBe(-1)
  })
})
