import { describe, expect, it } from 'vitest'
import { applyBattleResult, startBattle } from '../battle'
import { getUnitPower } from '../battleStrike'
import { eliminateLegionToCaretaker } from '../engagement'
import { isImmortal } from '../recruit'
import { twoPlayerGame } from './helpers'

describe('rules-caretaker', () => {
  it('E7: slain ordinary creatures stay out of the game (do not recycle)', () => {
    const state = twoPlayerGame(3)
    const loser = state.legions.find((l) => l.playerId === state.players[1].id)!
    const mob = loser.creatures.find((c) => !isImmortal(state.variant.creatures, c.type))!
    const before = state.caretaker[mob.type] ?? 0
    eliminateLegionToCaretaker(state, loser)
    expect(state.caretaker[mob.type] ?? 0).toBe(before)
  })

  it('E7: slain Lords/Demi-Lords return to the caretaker after the engagement', () => {
    const state = twoPlayerGame(4)
    const attacker = state.legions.find((l) => l.playerId === state.players[0].id)!
    const defender = state.legions.find((l) => l.playerId === state.players[1].id)!
    const hex =
      Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === 'Plains')?.label ??
      attacker.hexLabel
    attacker.hexLabel = hex
    defender.hexLabel = hex
    attacker.enteredFrom = 'Bottom'

    // Ensure defender has an Angel to kill
    if (!defender.creatures.some((c) => c.type === 'Angel')) {
      defender.creatures.push({ type: 'Angel', hits: 0 })
      state.caretaker.Angel = Math.max(0, (state.caretaker.Angel ?? 1) - 1)
    }
    const angelBefore = state.caretaker.Angel ?? 0

    const battle = startBattle(state, attacker, defender, () => 0.5)
    state.battle = battle
    for (const u of battle.units) {
      u.hex =
        u.legionId === battle.attackerLegionId
          ? battle.attackerEntrances[0]!
          : battle.defenderEntrances[0]!
    }

    const angel = battle.units.find(
      (u) => u.legionId === defender.id && u.creatureType === 'Angel',
    )!
    angel.hits = getUnitPower(state, angel)
    battle.fallen.push(angel)
    battle.units = battle.units.filter((u) => u.id !== angel.id)
    const idx = defender.creatures.findIndex((c) => c.type === 'Angel')
    if (idx >= 0) defender.creatures.splice(idx, 1)

    // Mid-battle: still not available
    expect(state.caretaker.Angel ?? 0).toBe(angelBefore)

    // Wipe defender so battle ends with attacker win
    for (const u of battle.units.filter((x) => x.legionId === defender.id)) {
      u.hits = 999
    }
    battle.done = true
    battle.winnerPlayerId = attacker.playerId
    applyBattleResult(state, battle)

    expect(state.caretaker.Angel ?? 0).toBe(angelBefore + 1)
  })

  it('E7: Titans are not immortal — eliminated Titans do not refill the caretaker', () => {
    const state = twoPlayerGame(5)
    const before = state.caretaker.Titan ?? 0
    const donor = state.legions.find((l) => l.playerId === state.players[1].id)!
    const titanOnly = {
      ...donor,
      creatures: [{ type: 'Titan', hits: 0 }],
      knownPublic: ['Titan'],
    }
    state.legions = state.legions.map((l) => (l.id === donor.id ? titanOnly : l))
    eliminateLegionToCaretaker(state, titanOnly)
    expect(state.caretaker.Titan ?? 0).toBe(before)
  })
})
