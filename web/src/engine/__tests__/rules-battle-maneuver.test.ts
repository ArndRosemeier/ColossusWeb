/**
 * B3 unentered kill, K2 must-strike, N1 skill budget, N3 contact lock, cliff contact.
 */
import { describe, expect, it } from 'vitest'
import {
  advanceBattlePhase,
  battleLand,
  getUnitSkill,
  isUnitAlive,
  legalBattleMovesFor,
  startBattle,
} from '../battle'
import { buildBattleland, isCliffBetween, meleeNeighbors } from '../battleland'
import { isInContact } from '../battleMovement'
import { twoPlayerGame } from './helpers'

function plainsBattle(extraAtk: string[] = ['Lion'], extraDef: string[] = ['Centaur']) {
  const state = twoPlayerGame(31)
  const alice = state.players[0]!
  const bob = state.players[1]!
  const attacker = state.legions.find((l) => l.playerId === alice.id)!
  const defender = state.legions.find((l) => l.playerId === bob.id)!
  attacker.creatures = [{ type: 'Titan', hits: 0 }, ...extraAtk.map((t) => ({ type: t, hits: 0 }))]
  defender.creatures = [{ type: 'Titan', hits: 0 }, ...extraDef.map((t) => ({ type: t, hits: 0 }))]
  const hex =
    Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Plains')?.label ??
    attacker.hexLabel
  attacker.hexLabel = hex
  defender.hexLabel = hex
  attacker.enteredFrom = 'Bottom'
  const battle = startBattle(state, attacker, defender, () => 0.5)
  state.battle = battle
  return { state, battle, alice, bob, attacker, defender, land: battleLand(state, battle) }
}

describe('B3 / K2 / N1 / N3 battle maneuver rules', () => {
  it('B3: unentered characters are eliminated after first Strikeback half', () => {
    const { state, battle, alice } = plainsBattle(['Ogre'], ['Centaur'])
    // Place only defender fully; leave one attacker off-board
    for (const u of battle.units) {
      if (u.legionId === battle.defenderLegionId) {
        u.hex = battle.defenderEntrances[0]!
      } else if (u.creatureType === 'Titan') {
        u.hex = battle.attackerEntrances[0]!
      } else {
        u.hex = null
      }
    }
    battle.firstManeuverDone = { attacker: false, defender: true }
    battle.turn = 1
    battle.phase = 'Strikeback'
    battle.activeHalf = 'attacker'
    battle.activePlayerId = alice.id
    for (const u of battle.units) u.struck = true

    const unentered = battle.units.find(
      (u) => u.legionId === battle.attackerLegionId && u.creatureType === 'Ogre',
    )!
    expect(unentered.hex).toBeNull()

    advanceBattlePhase(state, battle)

    expect(isUnitAlive(state, unentered)).toBe(false)
    expect(state.log.some((l) => l.includes('failed to enter'))).toBe(true)
  })

  it('K2: cannot end Strike while a living adjacent unit has not struck', () => {
    const { state, battle, land, alice } = plainsBattle(['Lion'], ['Centaur'])
    const atkHex = battle.attackerEntrances[0]!
    const defHex = land.hexByLabel[atkHex]!.neighbors.find((n) => n != null)!
    for (const u of battle.units) {
      if (u.legionId === battle.attackerLegionId && u.creatureType === 'Lion') u.hex = atkHex
      else if (u.legionId === battle.defenderLegionId && u.creatureType === 'Centaur') u.hex = defHex
      else {
        u.hex =
          u.legionId === battle.attackerLegionId
            ? battle.attackerEntrances[battle.attackerEntrances.length - 1]!
            : battle.defenderEntrances[0]!
      }
      u.struck = false
    }
    battle.firstManeuverDone = { attacker: true, defender: true }
    battle.phase = 'Strike'
    battle.activeHalf = 'attacker'
    battle.activePlayerId = alice.id

    expect(() => advanceBattlePhase(state, battle)).toThrow(/Must strike/i)
  })

  it('N3: unit in contact has no legal maneuvers', () => {
    const { state, battle, land } = plainsBattle(['Lion'], ['Centaur'])
    const atkHex = battle.attackerEntrances[0]!
    const defHex = land.hexByLabel[atkHex]!.neighbors.find((n) => n != null)!
    const lion = battle.units.find(
      (u) => u.legionId === battle.attackerLegionId && u.creatureType === 'Lion',
    )!
    const centaur = battle.units.find(
      (u) => u.legionId === battle.defenderLegionId && u.creatureType === 'Centaur',
    )!
    lion.hex = atkHex
    centaur.hex = defHex
    for (const u of battle.units) {
      if (u.id === lion.id || u.id === centaur.id) continue
      u.hex = battle.defenderEntrances[battle.defenderEntrances.length - 1]!
    }
    battle.phase = 'Move'
    battle.activeHalf = 'attacker'
    battle.activePlayerId = state.players[0]!.id

    expect(isInContact(state, battle, land, lion)).toBe(true)
    expect(legalBattleMovesFor(state, battle, lion)).toEqual([])
  })

  it('N1: skill-2 creature cannot reach a hex that costs 3+ from off-board entry', () => {
    const { state, battle } = plainsBattle(['Ogre'], ['Centaur'])
    // Ogre skill 2 — place off-board and list moves
    const ogre = battle.units.find(
      (u) => u.legionId === battle.attackerLegionId && u.creatureType === 'Ogre',
    )!
    ogre.hex = null
    for (const u of battle.units) {
      if (u.id === ogre.id) continue
      u.hex =
        u.legionId === battle.attackerLegionId
          ? battle.attackerEntrances[0]!
          : battle.defenderEntrances[0]!
    }
    battle.phase = 'Move'
    battle.activeHalf = 'attacker'
    battle.activePlayerId = state.players[0]!.id

    expect(getUnitSkill(state, ogre)).toBe(2)
    const moves = legalBattleMovesFor(state, battle, ogre)
    expect(moves.length).toBeGreaterThan(0)
    // All legal destinations must be reachable within skill (engine already filters);
    // assert we cannot reach the far defender entrance in one skill-2 move.
    const far = battle.defenderEntrances[0]!
    expect(moves).not.toContain(far)
  })

  it('Cliff: characters across a cliff are not in contact', () => {
    const nothing = Array(6).fill('nothing') as (
      | 'nothing'
      | 'dune'
      | 'cliff'
      | 'slope'
      | 'tower'
      | 'river'
    )[]
    const hexA = {
      label: 'A',
      x: 0,
      y: 0,
      terrain: 'Plains',
      elevation: 0,
      hexsides: [...nothing] as typeof nothing,
      neighbors: ['B', null, null, null, null, null] as (string | null)[],
    }
    const hexB = {
      label: 'B',
      x: 1,
      y: 0,
      terrain: 'Plains',
      elevation: 1,
      hexsides: [...nothing] as typeof nothing,
      neighbors: [null, null, null, 'A', null, null] as (string | null)[],
    }
    hexA.hexsides[0] = 'cliff'
    hexB.hexsides[3] = 'cliff'
    const land = {
      terrain: 'Test',
      tower: false,
      hexByLabel: { A: hexA, B: hexB },
      labels: ['A', 'B'],
      startlist: [],
      entrances: {
        Bottom: [],
        Left: [],
        Right: [],
        Top: [],
        LeftDefense: [],
        RightDefense: [],
      },
    } as ReturnType<typeof buildBattleland>

    expect(isCliffBetween(land, 'A', 'B')).toBe(true)
    expect(meleeNeighbors(land, 'A')).not.toContain('B')

    const state = twoPlayerGame(32)
    const unitA = {
      id: 'a1',
      legionId: 'atk',
      playerId: state.players[0]!.id,
      creatureType: 'Lion',
      hits: 0,
      hex: 'A',
      struck: false,
      moved: false,
      moveOriginHex: null,
    }
    const unitB = {
      id: 'b1',
      legionId: 'def',
      playerId: state.players[1]!.id,
      creatureType: 'Centaur',
      hits: 0,
      hex: 'B',
      struck: false,
      moved: false,
      moveOriginHex: null,
    }
    const battle = {
      units: [unitA, unitB],
      attackerLegionId: 'atk',
      defenderLegionId: 'def',
    }
    expect(isInContact(state, battle as never, land, unitA)).toBe(false)
  })
})
