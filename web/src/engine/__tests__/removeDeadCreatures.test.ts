import { describe, expect, it } from 'vitest'
import { advanceBattlePhase, removeDeadCreatures, startBattle } from '../battle'
import { getUnitPower } from '../battleStrike'
import { twoPlayerGame } from './helpers'

describe('removeDeadCreatures', () => {
  it('B-dead: after Strikeback, slain units leave the board (fallen for scoring)', () => {
    const state = twoPlayerGame(1)
    const attacker = state.legions.find((l) => l.playerId === state.players[0].id)!
    const defender = state.legions.find((l) => l.playerId === state.players[1].id)!
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

    const victim = battle.units.find(
      (u) => u.legionId === battle.defenderLegionId && u.creatureType !== 'Titan',
    )!
    const victimType = victim.creatureType
    const caretakerBefore = state.caretaker[victimType] ?? 0
    const defCreaturesBefore = defender.creatures.length

    victim.hits = getUnitPower(state, victim)
    expect(battle.units.some((u) => u.id === victim.id)).toBe(true)

    // Stay transparent during Strike / Strikeback — still on board
    battle.phase = 'Strike'
    expect(battle.units.some((u) => u.id === victim.id)).toBe(true)

    battle.phase = 'Strikeback'
    battle.activeHalf = 'defender'
    battle.activePlayerId = defender.playerId
    advanceBattlePhase(state, battle)

    expect(battle.done).toBe(false)
    expect(battle.units.some((u) => u.id === victim.id)).toBe(false)
    expect(battle.fallen.some((u) => u.id === victim.id)).toBe(true)
    expect(defender.creatures.length).toBe(defCreaturesBefore - 1)
    expect(state.caretaker[victimType] ?? 0).toBe(caretakerBefore + 1)
    expect(battle.phase).toBe('Move')
  })

  it('removeDeadCreatures is a no-op when everyone is alive', () => {
    const state = twoPlayerGame(2)
    const attacker = state.legions.find((l) => l.playerId === state.players[0].id)!
    const defender = state.legions.find((l) => l.playerId === state.players[1].id)!
    attacker.hexLabel = defender.hexLabel
    attacker.enteredFrom = 'Bottom'
    const battle = startBattle(state, attacker, defender, () => 0.5)
    const n = battle.units.length
    removeDeadCreatures(state, battle)
    expect(battle.units.length).toBe(n)
    expect(battle.fallen.length).toBe(0)
  })
})
