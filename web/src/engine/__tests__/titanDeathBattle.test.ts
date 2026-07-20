import { describe, expect, it } from 'vitest'
import {
  advanceBattlePhase,
  applyBattleResult,
  getUnitPower,
  startBattle,
} from '../battle'
import { twoPlayerGame } from './helpers'

function titanBattle() {
  const state = twoPlayerGame(3)
  const alice = state.players[0]!
  const bob = state.players[1]!
  const attacker = state.legions.find((l) => l.playerId === alice.id)!
  const defender = state.legions.find((l) => l.playerId === bob.id)!
  // Keep Titan + one fodder so the legion is not wiped when the Titan falls
  attacker.creatures = [
    { type: 'Titan', hits: 0 },
    { type: 'Ogre', hits: 0 },
  ]
  defender.creatures = [
    { type: 'Titan', hits: 0 },
    { type: 'Centaur', hits: 0 },
  ]
  const hex =
    Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Plains')?.label ??
    attacker.hexLabel
  attacker.hexLabel = hex
  defender.hexLabel = hex
  attacker.enteredFrom = 'Bottom'
  const battle = startBattle(state, attacker, defender, () => 0.5)
  state.battle = battle
  for (const u of battle.units) {
    u.hex =
      u.legionId === battle.attackerLegionId
        ? battle.attackerEntrances[0]!
        : battle.defenderEntrances[0]!
  }
  battle.firstManeuverDone = { attacker: true, defender: true }
  return { state, battle, alice, bob, attacker, defender }
}

describe('Titan death mid-battle', () => {
  it('S3: Titan slain ends battle after Strikeback even if other creatures live', () => {
    const { state, battle, alice, bob, defender } = titanBattle()
    const defTitan = battle.units.find(
      (u) => u.legionId === defender.id && u.creatureType === 'Titan',
    )!
    const defCentaur = battle.units.find(
      (u) => u.legionId === defender.id && u.creatureType === 'Centaur',
    )!
    defTitan.hits = getUnitPower(state, defTitan)
    // Centaur still alive — battle must not continue past Strikeback
    expect(defCentaur.hits).toBe(0)

    battle.phase = 'Strikeback'
    battle.activeHalf = 'defender'
    battle.activePlayerId = bob.id
    advanceBattlePhase(state, battle)

    expect(battle.done).toBe(true)
    expect(battle.endedByTitanKill).toBe(true)
    expect(battle.winnerPlayerId).toBe(alice.id)
    expect(battle.units.some((u) => u.id === defTitan.id)).toBe(false)

    applyBattleResult(state, battle)
    expect(bob.dead).toBe(true)
    expect(alice.dead).toBe(false)
    expect(state.winnerId).toBe(alice.id)
    expect(state.legions.some((l) => l.playerId === bob.id)).toBe(false)
  })

  it('S4: mutual Titan death (Strike + Strikeback) is a draw', () => {
    const { state, battle, alice, bob, attacker, defender } = titanBattle()
    const atkTitan = battle.units.find(
      (u) => u.legionId === attacker.id && u.creatureType === 'Titan',
    )!
    const defTitan = battle.units.find(
      (u) => u.legionId === defender.id && u.creatureType === 'Titan',
    )!
    // Both Titans lethal after the strike cycle; fodder still alive
    atkTitan.hits = getUnitPower(state, atkTitan)
    defTitan.hits = getUnitPower(state, defTitan)

    battle.phase = 'Strikeback'
    battle.activeHalf = 'attacker'
    battle.activePlayerId = alice.id
    advanceBattlePhase(state, battle)

    expect(battle.done).toBe(true)
    expect(battle.endedByTitanKill).toBe(true)
    expect(battle.winnerPlayerId).toBeNull()

    applyBattleResult(state, battle)
    expect(alice.dead).toBe(true)
    expect(bob.dead).toBe(true)
    expect(state.draw).toBe(true)
    expect(state.winnerId).toBeNull()
  })

  it('Titan damage alone does not end battle before Strikeback finishes', () => {
    const { state, battle, defender } = titanBattle()
    const defTitan = battle.units.find(
      (u) => u.legionId === defender.id && u.creatureType === 'Titan',
    )!
    defTitan.hits = getUnitPower(state, defTitan)
    battle.phase = 'Strike'
    // Still in Strike — dead stay on board until Strikeback removal
    expect(battle.done).toBe(false)
    expect(battle.units.some((u) => u.id === defTitan.id)).toBe(true)
    void state
  })
})
