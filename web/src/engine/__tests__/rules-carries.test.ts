/**
 * K5 carries + optional raised Strike-number (Titan Engagements).
 */
import { describe, expect, it } from 'vitest'
import {
  battleLand,
  doCarry,
  getStrikeNumber,
  getUnitPower,
  resolveStrikeFor,
  startBattle,
  advanceBattlePhase,
} from '../battle'
import { battleNeighbors } from '../battleland'
import { legalCarryTargetIds, listStrikeRaiseOptions } from '../battleStrike'
import { twoPlayerGame } from './helpers'

function plainsCarrySetup(defCreatures: string[]) {
  const state = twoPlayerGame(21)
  const alice = state.players[0]!
  const bob = state.players[1]!
  const attacker = state.legions.find((l) => l.playerId === alice.id)!
  const defender = state.legions.find((l) => l.playerId === bob.id)!
  attacker.creatures = [{ type: 'Titan', hits: 0 }, { type: 'Ogre', hits: 0 }]
  defender.creatures = [
    { type: 'Titan', hits: 0 },
    ...defCreatures.map((type) => ({ type, hits: 0 })),
  ]
  const hex =
    Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Plains')?.label ??
    attacker.hexLabel
  attacker.hexLabel = hex
  defender.hexLabel = hex
  attacker.enteredFrom = 'Bottom'
  const battle = startBattle(state, attacker, defender, () => 0.5)
  state.battle = battle
  const land = battleLand(state, battle)
  const atkHex = battle.attackerEntrances[0]!
  const ring = battleNeighbors(land, atkHex)
  expect(ring.length).toBeGreaterThanOrEqual(2)

  const ogre = battle.units.find(
    (u) => u.legionId === battle.attackerLegionId && u.creatureType === 'Ogre',
  )!
  ogre.hex = atkHex

  const fodder = battle.units.filter(
    (u) => u.legionId === battle.defenderLegionId && u.creatureType !== 'Titan',
  )
  fodder.forEach((u, i) => {
    u.hex = ring[i % ring.length]!
  })
  // Park Titans out of the way
  for (const u of battle.units) {
    if (u.creatureType === 'Titan') {
      u.hex =
        u.legionId === battle.attackerLegionId
          ? battle.attackerEntrances[battle.attackerEntrances.length - 1]!
          : battle.defenderEntrances[battle.defenderEntrances.length - 1]!
    }
  }
  battle.firstManeuverDone = { attacker: true, defender: true }
  battle.phase = 'Strike'
  battle.activeHalf = 'attacker'
  battle.activePlayerId = alice.id
  return { state, battle, land, alice, bob, ogre, fodder }
}

describe('K5 carries', () => {
  it('K5a: overkill does not free-carry onto a harder Strike-number target', () => {
    // Titan rule: cannot carry to a character needing a higher SN
    const { state, battle, land, ogre, fodder } = plainsCarrySetup(['Lion', 'Centaur'])
    const lion = fodder.find((u) => u.creatureType === 'Lion')!
    const centaur = fodder.find((u) => u.creatureType === 'Centaur')!
    expect(battleNeighbors(land, ogre.hex!).includes(lion.hex!)).toBe(true)
    expect(battleNeighbors(land, ogre.hex!).includes(centaur.hex!)).toBe(true)

    const snLion = getStrikeNumber(state, ogre, lion, land, true)
    const snCentaur = getStrikeNumber(state, ogre, centaur, land, true)
    expect(snCentaur).toBeGreaterThan(snLion)

    lion.hits = getUnitPower(state, lion) - 2
    const rolls = Array.from({ length: 6 }, () => 6)
    resolveStrikeFor(state, battle, ogre.id, lion.id, () => 0.5, rolls)

    // Only harder neighbor → no free carry list
    expect(legalCarryTargetIds(state, battle, land, ogre, lion)).not.toContain(centaur.id)
    if (battle.pendingCarry) {
      expect(battle.pendingCarry.targetIds).not.toContain(centaur.id)
    } else {
      expect(battle.pendingCarry).toBeNull()
    }
  })

  it('K5b: raised Strike-number allows carry onto harder adjacent target', () => {
    const { state, battle, land, ogre, fodder } = plainsCarrySetup(['Lion', 'Centaur'])
    const lion = fodder.find((u) => u.creatureType === 'Lion')!
    const centaur = fodder.find((u) => u.creatureType === 'Centaur')!
    const snLion = getStrikeNumber(state, ogre, lion, land, true)
    const snCentaur = getStrikeNumber(state, ogre, centaur, land, true)
    expect(snCentaur).toBeGreaterThan(snLion)

    lion.hits = getUnitPower(state, lion) - 2
    const rolls = Array.from({ length: 6 }, () => 6)
    resolveStrikeFor(state, battle, ogre.id, lion.id, () => 0.5, rolls, snCentaur)

    expect(battle.pendingCarry).not.toBeNull()
    expect(battle.pendingCarry!.targetIds).toContain(centaur.id)
    expect(battle.pendingCarry!.hitsLeft).toBeGreaterThan(0)

    const before = centaur.hits
    const carryHits = battle.pendingCarry!.hitsLeft
    doCarry(state, battle, centaur.id)
    expect(centaur.hits).toBe(before + carryHits)
    expect(battle.pendingCarry).toBeNull()
  })

  it('K5b2: listStrikeRaiseOptions offers raised SN that unlocks harder carry', () => {
    const { state, battle, land, ogre, fodder } = plainsCarrySetup(['Lion', 'Centaur'])
    const lion = fodder.find((u) => u.creatureType === 'Lion')!
    const centaur = fodder.find((u) => u.creatureType === 'Centaur')!
    const { naturalNeed, options } = listStrikeRaiseOptions(state, battle, land, ogre, lion)
    expect(naturalNeed).toBe(getStrikeNumber(state, ogre, lion, land, true))
    expect(options.length).toBeGreaterThan(0)
    const unlock = options.find((o) => o.newlyEnabledIds.includes(centaur.id))
    expect(unlock).toBeTruthy()
    expect(unlock!.need).toBe(getStrikeNumber(state, ogre, centaur, land, true))
  })

  it('K5c: cannot end Strike while pendingCarry remains', () => {
    const { state, battle, ogre, fodder } = plainsCarrySetup(['Lion', 'Lion'])
    const a = fodder[0]!
    const b = fodder[1]!
    a.hits = getUnitPower(state, a) - 1
    resolveStrikeFor(
      state,
      battle,
      ogre.id,
      a.id,
      () => 0.5,
      Array.from({ length: 6 }, () => 6),
    )
    expect(battle.pendingCarry).not.toBeNull()
    expect(battle.pendingCarry!.targetIds).toContain(b.id)
    expect(() => advanceBattlePhase(state, battle)).toThrow(/carry/i)
  })
})
