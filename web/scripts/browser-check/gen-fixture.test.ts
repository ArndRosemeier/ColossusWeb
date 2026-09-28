/**
 * S6 — the FIXTURE GENERATOR for the browser check, and nothing else.
 *
 * It is deliberately OUTSIDE `src/` so `vite.config.ts`'s `include`
 * (`src/**​/*.test.ts`) never picks it up in the gate: this is not a pin, and the
 * gate must not depend on a file that writes to disk. Run it on purpose:
 *
 *     cd web && npx vitest run --config scripts/browser-check/vitest.config.ts
 *
 * What it does: builds a real mid-game `GameState` through the REAL engine (a
 * turn-1 split, then the next player's roll), finds a host legion whose legal
 * destinations DIFFER between the roll the local client holds and the roll the
 * adopted snapshot carries, and writes `fixture.json` beside this file. Every
 * set in that file is the ENGINE's own `getMovesForSelected` output — never a
 * second implementation of the movement rule.
 *
 * The shape mirrors the owner's LIVE snapshot (`snap.number-1-8e21f4f8.0002.001`):
 * a remote state in `Move`, `movementRoll: 3`, nothing selected, `legalHexes: []`
 * — adopted by a client whose LOCAL state still holds the PREVIOUS roll (6) and
 * a non-empty set computed for it.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { dispatch, getMovesForSelected } from '../../src/engine/GameEngine'
import type { GameState } from '../../src/engine/types'
import { twoPlayerGame, turn1SplitChild } from '../../src/engine/__tests__/helpers'
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

const GAME_ID = 's6stale-0001abcd'
const HOST_ID = 'key_s6host01'
const HOST_TAG = 'key_s6ho'
const GUEST_ID = 'zzzzs6guest'
const GUEST_TAG = 'zzzzs6gu'
const MY_ROLL = 6
const ADOPTED_ROLL = 3
/**
 * The round the snapshot carries. It is written into the STATE as well as the
 * header, because that is the live invariant: `publishSnapshot` names a snapshot
 * `(state.turnNumber, seq)`, so a fixture whose header round and state round
 * disagree would make the app publish a name that sorts BEFORE the snapshot it
 * just adopted — a fixture artefact, not a defect (the owner's live state has
 * `turnNumber: 2`, phase `Move`).
 */
const ROUND = 2
/** What the LOCAL state carries in the field under test; adoption must not copy it. */
const SENTINEL = 'S6STALE'

function doneSplit(state: GameState): GameState {
  return dispatch(state, { type: 'doneSplit' }, () => 0.5)
}

function setRoll(state: GameState, roll: number): GameState {
  const next = structuredClone(state)
  next.movementRoll = roll
  return next
}

function destinationsOf(state: GameState, legionId: string): string[] {
  return [...getMovesForSelected(dispatch(state, { type: 'selectLegion', legionId })).keys()].sort()
}

interface Scenario {
  /** Player 0's Move phase, no selection — the state the owner's snapshot holds. */
  readonly adoptedState: GameState
  /** The same state with the LOCAL client's previous roll (6). */
  readonly localState: GameState
  readonly seed: number
  readonly marker: string
  /** The legion's legal destinations on roll 6 and on roll 3, from the ENGINE. */
  readonly destinationsOnMyRoll: string[]
  readonly destinationsOnAdoptedRoll: string[]
}

/**
 * Walk real games until one has a host legion whose destination set on roll 6 is
 * a strict SUPERSET of its set on roll 3 — so "rolled a 3, still flashing a 6"
 * is observable, and a move that is legal on roll 6 but not on roll 3 exists.
 */
function findScenario(): Scenario {
  for (let seed = 1; seed <= 80; seed++) {
    let host = twoPlayerGame(seed)
    const opening = host.legions.find((l) => l.playerId === host.players[0]!.id)!
    host = dispatch(host, {
      type: 'split',
      parentId: opening.id,
      childCreatures: turn1SplitChild(host, opening),
    })
    host = doneSplit(host)
    if (host.phase !== 'Move' || host.activePlayerIndex !== 0) continue
    host.turnNumber = ROUND

    const localState = setRoll(host, MY_ROLL)
    const adoptedState = setRoll(host, ADOPTED_ROLL)
    adoptedState.selectedLegionId = null
    adoptedState.legalHexes = []

    for (const legion of host.legions.filter((l) => l.playerId === host.players[0]!.id)) {
      const big = destinationsOf(localState, legion.id)
      const small = destinationsOf(adoptedState, legion.id)
      if (small.length === 0) continue
      if (big.length <= small.length) continue
      if (!small.every((hex) => big.includes(hex))) continue
      return {
        adoptedState,
        localState,
        seed,
        marker: legion.markerId,
        destinationsOnMyRoll: big,
        destinationsOnAdoptedRoll: small,
      }
    }
  }
  throw new Error('no seed produced the scenario the browser check needs')
}

function snapshot(
  state: GameState,
  turn: number,
  seq: number,
  tag: string,
  parent: string | null,
): SnapshotBody {
  return {
    header: {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      name: snapshotObjectName(GAME_ID, turn, seq, tag),
      gameId: GAME_ID,
      turn,
      seq,
      writerTag: tag,
      seat: 0,
      parent,
      createdAt: '2026-09-29T09:15:19.000Z',
    },
    state: serializeGame(state),
  }
}

function gameRecord(): GameRecord {
  return {
    version: GAME_RECORD_VERSION,
    gameId: GAME_ID,
    displayName: 'S6 stale legalHexes',
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

describe('S6 browser-check fixture', () => {
  it('writes the states the check drives the real UI with', () => {
    const scenario = findScenario()
    const local = scenario.localState
    const adopted = scenario.adoptedState
    const hostHex = local.legions.find((l) => l.markerId === scenario.marker)!.hexLabel

    // The local client holds roll 6 with a non-empty set computed for it; the
    // adopted snapshot is roll 3 with nothing selected (the owner's live shape).
    expect(local.movementRoll).toBe(MY_ROLL)
    expect(adopted.movementRoll).toBe(ADOPTED_ROLL)
    expect(scenario.destinationsOnMyRoll.length).toBeGreaterThan(
      scenario.destinationsOnAdoptedRoll.length,
    )
    expect(scenario.destinationsOnAdoptedRoll.every((hex) => scenario.destinationsOnMyRoll.includes(hex))).toBe(true)

    const localSelection = dispatch(local, { type: 'selectLegion', legionId: local.legions.find((l) => l.markerId === scenario.marker)!.id })

    const first = snapshot(local, ROUND, 0, HOST_TAG, null)
    const adoptedBody = snapshot(adopted, ROUND, 1, HOST_TAG, first.header.name)

    const fixture = {
      generatedBy: 'web/scripts/browser-check/gen-fixture.test.ts',
      gameId: GAME_ID,
      host: { id: HOST_ID, tag: HOST_TAG, seat: 0 },
      guest: { id: GUEST_ID, tag: GUEST_TAG, seat: 1 },
      marker: scenario.marker,
      seed: scenario.seed,
      myRoll: local.movementRoll,
      adoptedRoll: adopted.movementRoll,
      legionId: local.legions.find((l) => l.markerId === scenario.marker)!.id,
      legionHex: hostHex,
      sentinel: SENTINEL,
      /** The engine's set for the legion on the LOCAL client's roll (6). */
      destinationsOnMyRoll: scenario.destinationsOnMyRoll,
      /** The engine's set for the same legion on the ADOPTED roll (3). */
      destinationsOnAdoptedRoll: scenario.destinationsOnAdoptedRoll,
      /** A destination only roll 6 reaches — it must NOT be highlighted on roll 3. */
      roll6OnlyDestination: scenario.destinationsOnMyRoll.find(
        (hex) => !scenario.destinationsOnAdoptedRoll.includes(hex),
      ),
      localLegalHexes: localSelection.legalHexes,
      firstSnapshotName: first.header.name,
      adoptedSnapshotName: adoptedBody.header.name,
      records: {
        game: serializeGameRecord(gameRecord()),
        players: [
          serializePlayerRecord(playerRecord(HOST_ID, 'host')),
          serializePlayerRecord(playerRecord(GUEST_ID, 'guest')),
        ],
      },
      firstSnapshot: serializeSnapshot(first),
      adoptedSnapshot: serializeSnapshot(adoptedBody),
    }

    // The snapshots must survive the app's OWN parser, or the check would drive
    // the UI with bytes the real client would refuse.
    expect(parseSnapshot(fixture.firstSnapshot).header.name).toBe(first.header.name)
    expect(parseSnapshot(fixture.adoptedSnapshot).header.name).toBe(adoptedBody.header.name)
    expect(parseGameRecord(fixture.records.game).gameId).toBe(GAME_ID)
    expect(fixture.roll6OnlyDestination).toBeDefined()
    expect(new Set(fixture.localLegalHexes).size).toBe(fixture.localLegalHexes.length)

    // The repo's own `scripts/browser-check/`, where the Python check reads it.
    const target = resolve(here, '..', '..', '..', 'scripts', 'browser-check', 'fixture.json')
    mkdirSync(here, { recursive: true })
    writeFileSync(target, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
    // eslint-disable-next-line no-console
    console.log(
      `S6 FIXTURE: ${target}\n  marker ${scenario.marker} @${hostHex}\n  roll6 ${scenario.destinationsOnMyRoll.length} -> roll3 ${scenario.destinationsOnAdoptedRoll.length}`,
    )
  })
})
