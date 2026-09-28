/**
 * S9 — the FIXTURE GENERATOR for the browser check, and nothing else.
 *
 * Deliberately OUTSIDE `src/` so the gate never depends on a file that writes to
 * disk (same rule as S6's and S8's generators). Run it on purpose:
 *
 *     cd web && npx vitest run --config scripts/browser-check/vitest.config.s9.ts
 *
 * WHAT IT WRITES. Three things the check drives the REAL app with, all built
 * through the REAL engine and round-tripped through the app's OWN parsers:
 *
 *  1. `resign` — a STARTED two-human game, the caller (seat 0) to move. This is
 *     the state in which "Give up the game" must be offered, confirmed, and then
 *     end the game (the two-player case).
 *  2. `mine` — a game the caller CREATED and JOINED, with several snapshots. The
 *     caller may delete it.
 *  3. `theirs` — a game created by ANOTHER key, which the caller never joined. The
 *     caller must NOT be offered a delete for it, and nothing of it may be
 *     touched.
 *
 * Every body is serialised by the module that owns its shape (`serializeGame`,
 * `serializeGameRecord`, `serializePlayerRecord`, `serializeSnapshot`), and the
 * snapshots are named by `snapshotObjectName`, so the store holds bytes a real
 * client would accept — nothing here re-implements a rule or a name.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createGame, dispatch, resignRefusalReason } from '../../src/engine/GameEngine'
import type { GameState } from '../../src/engine/types'
import { loadDefaultVariant } from '../../src/engine/__tests__/helpers'
import { serializeGame } from '../../src/persistence/saveGame'
import {
  GAME_RECORD_VERSION,
  PLAYER_RECORD_VERSION,
  gameObjectName,
  parseGameRecord,
  parsePlayerRecord,
  playerObjectName,
  playerTagFor,
  serializeGameRecord,
  serializePlayerRecord,
  type GameRecord,
  type PlayerRecord,
} from '../../src/net/gameRecord'
import {
  SNAPSHOT_SCHEMA_VERSION,
  parseSnapshot,
  serializeSnapshot,
  snapshotObjectName,
  type SnapshotBody,
} from '../../src/net/snapshot'

const here = dirname(fileURLToPath(import.meta.url))

/** The identity the fake store reports for the caller's made-up key. */
const MINE_ID = 'FPYGNDslev_p'
const OTHERS_ID = 'i9PGQ7wIj971'
const MINE_TAG = playerTagFor(MINE_ID)
const OTHERS_TAG = playerTagFor(OTHERS_ID)

const RESIGN_GAME = 's9resign-0001abcd'
const MINE_GAME = 's9mine-0001abcd'
const THEIRS_GAME = 's9theirs-0001abcd'
const ROUND = 2

function gameRecord(gameId: string, displayName: string, creatorId: string, creatorLabel: string, seats: string[]): GameRecord {
  return {
    version: GAME_RECORD_VERSION,
    gameId,
    displayName,
    variant: 'Default',
    creator: { id: creatorId, label: creatorLabel },
    status: 'started',
    maxPlayers: 2,
    seatOrder: seats,
    createdAt: '2026-09-29T09:00:00.000Z',
  }
}

function playerRecord(gameId: string, id: string, label: string): PlayerRecord {
  return {
    version: PLAYER_RECORD_VERSION,
    gameId,
    playerId: id,
    label,
    joinedAt: '2026-09-29T09:01:00.000Z',
  }
}

/** `count` snapshot bodies for a game, chained by `parent` like the real writer. */
function snapshots(gameId: string, tag: string, count: number): Array<{ name: string; body: SnapshotBody }> {
  const out: Array<{ name: string; body: SnapshotBody }> = []
  let parent: string | null = null
  for (let seq = 0; seq < count; seq++) {
    const name = snapshotObjectName(gameId, ROUND, seq, tag)
    const body: SnapshotBody = {
      header: {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        name,
        gameId,
        turn: ROUND,
        seq,
        writerTag: tag,
        seat: 0,
        parent,
        createdAt: '2026-09-29T10:00:00.000Z',
      },
      state: serializeGame(emptyBlobState()),
    }
    out.push({ name, body })
    parent = name
  }
  return out
}

/**
 * A snapshot for a game that is NOT the resign game needs SOME state, and it must
 * be a blob `deserializeGame`-shaped enough to parse. The check never adopts
 * these (it only lists and deletes them), but the body still goes through
 * `parseSnapshot`, so it must be a real save blob.
 */
let sharedBlobState: GameState | null = null
function emptyBlobState(): GameState {
  if (sharedBlobState === null) {
    sharedBlobState = createGame(loadDefaultVariant(), {
      players: [
        { name: 'Test', kind: 'human' },
        { name: 'Test2', kind: 'human' },
      ],
      seed: 5,
    })
  }
  return sharedBlobState
}

/** A started two-human game the caller is seat 0 of — the give-up state. */
function resignGame(): GameState {
  return createGame(loadDefaultVariant(), {
    players: [
      { name: 'Test', kind: 'human' },
      { name: 'Test2', kind: 'human' },
    ],
    seed: 17,
  })
}

/**
 * The SAME game with a BATTLE running — the state in which the owner's scope says
 * giving up is not offered. It is reached the engine's own way: seat the attacker
 * on the defender's hex, open the engagement, let the defender stand, then begin
 * the battle.
 */
function battleGame(): GameState {
  const base = resignGame()
  const attacker = base.legions[0]!
  const defender = base.legions[1]!
  defender.creatures = [
    { type: 'Centaur', hits: 0 },
    { type: 'Ogre', hits: 0 },
  ]
  defender.knownPublic = ['Centaur', 'Ogre']
  attacker.hexLabel = defender.hexLabel
  base.phase = 'Fight'
  base.pendingEngagements = [{ attackerId: attacker.id, defenderId: defender.id }]
  const opened = dispatch(base, {
    type: 'startEngagement',
    attackerId: attacker.id,
    defenderId: defender.id,
  })
  const standing = dispatch(opened, { type: 'standFight' })
  const battle = dispatch(standing, {
    type: 'startEngagement',
    attackerId: attacker.id,
    defenderId: defender.id,
  })
  return battle
}

describe('S9 browser-check fixture', () => {
  it('writes the states the check drives the real UI with', () => {
    const state = resignGame()
    expect(state.phase).toBe('Split')
    expect(state.battle).toBeNull()
    expect(state.activeEngagement).toBeNull()
    // The caller may give up in this state, and the OTHER player may too.
    expect(resignRefusalReason(state, state.players[0]!.id)).toBeNull()
    expect(resignRefusalReason(state, state.players[1]!.id)).toBeNull()

    const resignSnapshot: SnapshotBody = {
      header: {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        name: snapshotObjectName(RESIGN_GAME, ROUND, 0, MINE_TAG),
        gameId: RESIGN_GAME,
        turn: ROUND,
        seq: 0,
        writerTag: MINE_TAG,
        seat: 0,
        parent: null,
        createdAt: '2026-09-29T10:00:00.000Z',
      },
      state: serializeGame(state),
    }

    // The battle state, for the "inside a battle it is refused" mode.
    const inBattle = battleGame()
    expect(inBattle.battle).not.toBeNull()
    expect(resignRefusalReason(inBattle, inBattle.players[0]!.id)).toMatch(/battle/i)
    const battleSnapshot: SnapshotBody = {
      header: {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        name: snapshotObjectName(RESIGN_GAME, ROUND, 1, MINE_TAG),
        gameId: RESIGN_GAME,
        turn: ROUND,
        seq: 1,
        writerTag: MINE_TAG,
        seat: 0,
        parent: resignSnapshot.header.name,
        createdAt: '2026-09-29T10:05:00.000Z',
      },
      state: serializeGame(inBattle),
    }

    const mineSnaps = snapshots(MINE_GAME, MINE_TAG, 4)
    const theirsSnaps = snapshots(THEIRS_GAME, OTHERS_TAG, 2)

    const fixture = {
      generatedBy: 'web/scripts/browser-check/gen-fixture-s9.test.ts',
      round: ROUND,
      caller: { id: MINE_ID, tag: MINE_TAG, label: 'Test' },
      other: { id: OTHERS_ID, tag: OTHERS_TAG, label: 'Test2' },
      resign: {
        gameId: RESIGN_GAME,
        snapshotName: resignSnapshot.header.name,
        snapshot: serializeSnapshot(resignSnapshot),
        inBattleSnapshotName: battleSnapshot.header.name,
        inBattleSnapshot: serializeSnapshot(battleSnapshot),
        record: serializeGameRecord(
          gameRecord(RESIGN_GAME, "Test's resign game", MINE_ID, 'Test', [MINE_ID, OTHERS_ID]),
        ),
        players: [
          serializePlayerRecord(playerRecord(RESIGN_GAME, MINE_ID, 'Test')),
          serializePlayerRecord(playerRecord(RESIGN_GAME, OTHERS_ID, 'Test2')),
        ],
        playerIds: [state.players[0]!.id, state.players[1]!.id],
        playerNames: [state.players[0]!.name, state.players[1]!.name],
      },
      mine: {
        gameId: MINE_GAME,
        record: serializeGameRecord(
          gameRecord(MINE_GAME, "Test's old game", MINE_ID, 'Test', [MINE_ID, OTHERS_ID]),
        ),
        players: [
          serializePlayerRecord(playerRecord(MINE_GAME, MINE_ID, 'Test')),
          serializePlayerRecord(playerRecord(MINE_GAME, OTHERS_ID, 'Test2')),
        ],
        snapshotNames: mineSnaps.map((snap) => snap.name),
        snapshots: mineSnaps.map((snap) => serializeSnapshot(snap.body)),
      },
      theirs: {
        gameId: THEIRS_GAME,
        record: serializeGameRecord(
          gameRecord(THEIRS_GAME, "Test2's game", OTHERS_ID, 'Test2', [OTHERS_ID, MINE_ID]),
        ),
        players: [serializePlayerRecord(playerRecord(THEIRS_GAME, OTHERS_ID, 'Test2'))],
        snapshotNames: theirsSnaps.map((snap) => snap.name),
        snapshots: theirsSnaps.map((snap) => serializeSnapshot(snap.body)),
      },
    }

    // The app's OWN parsers must accept every body, or the check would drive the
    // UI with bytes the real client would refuse.
    expect(parseSnapshot(fixture.resign.snapshot).header.gameId).toBe(RESIGN_GAME)
    for (const body of fixture.mine.snapshots) {
      expect(parseSnapshot(body).header.gameId).toBe(MINE_GAME)
    }
    for (const body of fixture.theirs.snapshots) {
      expect(parseSnapshot(body).header.gameId).toBe(THEIRS_GAME)
    }
    expect(parseGameRecord(fixture.mine.record).seatOrder).toEqual([MINE_ID, OTHERS_ID])
    for (const body of [...fixture.mine.players, ...fixture.theirs.players, ...fixture.resign.players]) {
      expect(parsePlayerRecord(body).gameId).toMatch(/^s9/)
    }

    const target = resolve(here, '..', '..', '..', 'scripts', 'browser-check', 's9-fixture.json')
    mkdirSync(here, { recursive: true })
    writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
    // eslint-disable-next-line no-console
    console.log(
      `S9 FIXTURE: ${target}\n  resign ${RESIGN_GAME} · mine ${MINE_GAME} (${mineSnaps.length} snapshots) · theirs ${THEIRS_GAME}`,
    )
    expect(gameObjectName(MINE_GAME)).toBe(`game.${MINE_GAME}`)
    expect(playerObjectName(MINE_GAME, MINE_TAG)).toContain(MINE_TAG)
  })
})
