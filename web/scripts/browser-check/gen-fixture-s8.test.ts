/**
 * S8 — the FIXTURE GENERATOR for the browser check, and nothing else.
 *
 * Deliberately OUTSIDE `src/` so the gate never depends on a file that writes to
 * disk (same rule as the S6 generator). Run it on purpose:
 *
 *     cd web && npx vitest run --config scripts/browser-check/vitest.config.s8.ts
 *
 * WHAT IT WRITES. A REAL mid-game `GameState`, built through the REAL engine,
 * stopped at the moment the owner's bug happened: two HUMAN players, the mover's
 * legion in a `Fight` phase with an engagement PENDING against the other
 * player's — the state in which one click used to hand the attacker the battle
 * and skip the defender's `flee or fight` window.
 *
 * It writes TWO snapshots, because the check drives two browsers:
 *
 *   `pending`  — `activeEngagement: null`, the pending engagement the attacker's
 *                client opens with "Start engagement" (the real flow, and where
 *                the owner's bug bit);
 *   `opened`   — the same game with `activeEngagement.fleeDeclined === false`,
 *                so the DEFENDER's client can be seeded straight into the window
 *                its own client must be showing it.
 *
 * The snapshot PARENT chain is `pending` → `opened` → whatever the app publishes
 * next, so a client that adopts one then the other is following the real order.
 *
 * Every value here comes from the engine and is round-tripped through the app's
 * OWN parser before it is written; nothing in this file re-implements a rule.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createGame, dispatch } from '../../src/engine/GameEngine'
import type { GameState } from '../../src/engine/types'
import { loadDefaultVariant } from '../../src/engine/__tests__/helpers'
import { serializeGame } from '../../src/persistence/saveGame'
import {
  GAME_RECORD_VERSION,
  PLAYER_RECORD_VERSION,
  parseGameRecord,
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

const GAME_ID = 's8engage-0001abcd'
const HOST_ID = 'FPYGNDslev_p' // the fake store's identity for the host key
const HOST_TAG = HOST_ID.slice(0, 8).toLowerCase()
const GUEST_ID = 'i9PGQ7wIj971'
const GUEST_TAG = GUEST_ID.slice(0, 8).toLowerCase()
const ROUND = 3

function snapshot(
  state: GameState,
  seq: number,
  tag: string,
  parent: string | null,
): SnapshotBody {
  return {
    header: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      name: snapshotObjectName(GAME_ID, ROUND, seq, tag),
      gameId: GAME_ID,
      turn: ROUND,
      seq,
      writerTag: tag,
      seat: 0,
      parent,
      createdAt: '2026-09-29T10:00:00.000Z',
    },
    state: serializeGame(state),
  }
}

function gameRecord(): GameRecord {
  return {
    version: GAME_RECORD_VERSION,
    gameId: GAME_ID,
    displayName: 'S8 engagement choice',
    variant: 'Default',
    creator: { id: HOST_ID, label: 'host' },
    status: 'started',
    maxPlayers: 2,
    seatOrder: [HOST_ID, GUEST_ID],
    createdAt: '2026-09-29T09:00:00.000Z',
  }
}

function playerRecord(id: string, label: string): PlayerRecord {
  return {
    version: PLAYER_RECORD_VERSION,
    gameId: GAME_ID,
    playerId: id,
    label,
    joinedAt: '2026-09-29T09:01:00.000Z',
  }
}

/**
 * A two-human game stopped with an engagement PENDING: the mover (seat 0) has a
 * legion on the same hex as the other player's, phase `Fight`, and neither
 * legion holds a Lord, so the defender's Flee is legal (Titan: "a defending
 * Legion containing a Lord cannot flee").
 */
function pendingEngagementState(): GameState {
  for (let seed = 1; seed <= 40; seed++) {
    const state = createGame(loadDefaultVariant(), {
      players: [
        { name: 'Alice', kind: 'human' },
        { name: 'Bob', kind: 'human' },
      ],
      seed,
    })
    const attacker = state.legions.find((l) => l.playerId === state.players[0]!.id)
    const defender = state.legions.find((l) => l.playerId === state.players[1]!.id)
    if (!attacker || !defender) continue
    // The defender is the one whose window this is: no Lords, so Flee is legal.
    defender.creatures = [
      { type: 'Centaur', hits: 0 },
      { type: 'Ogre', hits: 0 },
    ]
    defender.knownPublic = ['Centaur', 'Ogre']
    attacker.hexLabel = defender.hexLabel
    state.phase = 'Fight'
    state.turnNumber = ROUND
    state.pendingEngagements = [{ attackerId: attacker.id, defenderId: defender.id }]
    // The engine's OWN opening of the engagement — the exact moment the phase
    // stops being pending and the defender's window is demanded.
    const opened = dispatch(state, {
      type: 'startEngagement',
      attackerId: attacker.id,
      defenderId: defender.id,
    })
    if (opened.activeEngagement?.fleeDeclined !== false) continue
    return state
  }
  throw new Error('no seed produced the pending engagement the browser check needs')
}

describe('S8 browser-check fixture', () => {
  it('writes the two states the check drives the real UI with', () => {
    const pending = pendingEngagementState()
    const attacker = pending.legions.find((l) => l.playerId === pending.players[0]!.id)!
    const defender = pending.legions.find((l) => l.playerId === pending.players[1]!.id)!

    const opened = dispatch(pending, {
      type: 'startEngagement',
      attackerId: attacker.id,
      defenderId: defender.id,
    })
    // The window is OPEN: this is what the defender's client must be shown, and
    // what the attacker's client must NOT be able to close alone.
    expect(opened.activeEngagement?.fleeDeclined).toBe(false)
    expect(opened.battle).toBeNull()
    expect(opened.phase).toBe('Fight')

    const pendingBody = snapshot(pending, 0, HOST_TAG, null)
    const openedBody = snapshot(opened, 1, HOST_TAG, pendingBody.header.name)

    const fixture = {
      generatedBy: 'web/scripts/browser-check/gen-fixture-s8.test.ts',
      gameId: GAME_ID,
      round: ROUND,
      host: { id: HOST_ID, tag: HOST_TAG, seat: 0 },
      guest: { id: GUEST_ID, tag: GUEST_TAG, seat: 1 },
      attackerLegionId: attacker.id,
      attackerMarkerId: attacker.markerId,
      defenderLegionId: defender.id,
      defenderMarkerId: defender.markerId,
      engagementHex: attacker.hexLabel,
      pendingSnapshotName: pendingBody.header.name,
      openedSnapshotName: openedBody.header.name,
      pendingSnapshot: serializeSnapshot(pendingBody),
      openedSnapshot: serializeSnapshot(openedBody),
      records: {
        game: serializeGameRecord(gameRecord()),
        players: [
          serializePlayerRecord(playerRecord(HOST_ID, 'host')),
          serializePlayerRecord(playerRecord(GUEST_ID, 'guest')),
        ],
      },
    }

    // The app's OWN parsers must accept every body, or the check would drive the
    // UI with bytes the real client would refuse.
    expect(parseSnapshot(fixture.pendingSnapshot).header.name).toBe(pendingBody.header.name)
    expect(parseSnapshot(fixture.openedSnapshot).header.name).toBe(openedBody.header.name)
    expect(parseGameRecord(fixture.records.game).seatOrder).toEqual([HOST_ID, GUEST_ID])
    for (const player of fixture.records.players) {
      expect(JSON.parse(player).gameId).toBe(GAME_ID)
    }

    const target = resolve(here, '..', '..', '..', 'scripts', 'browser-check', 's8-fixture.json')
    mkdirSync(here, { recursive: true })
    writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
    // eslint-disable-next-line no-console
    console.log(
      `S8 FIXTURE: ${target}\n  ${attacker.markerId} vs ${defender.markerId} @${attacker.hexLabel}`,
    )
  })
})
