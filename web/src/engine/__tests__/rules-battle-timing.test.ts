import { describe, expect, it } from 'vitest'
import {
  MAX_BATTLE_TURNS,
  advanceBattlePhase,
  applyBattleResult,
  applyTimeLoss,
  startBattle,
} from '../battle'
import { twoPlayerGame } from './helpers'
import type { BattleState, GameState } from '../types'

function battleOnTerrain(terrain: string): { state: GameState; battle: BattleState } {
  const state = twoPlayerGame(1)
  const attacker = state.legions.find((l) => l.playerId === state.players[0].id)!
  const defender = state.legions.find((l) => l.playerId === state.players[1].id)!
  const hex =
    Object.values(state.variant.board.hexByLabel).find((h) => h.terrain === terrain)?.label ??
    attacker.hexLabel
  attacker.hexLabel = hex
  defender.hexLabel = hex
  attacker.enteredFrom = 'Bottom'
  const battle = startBattle(state, attacker, defender, () => 0.5)
  state.battle = battle
  return { state, battle }
}

describe('rules-battle-timing', () => {
  it('A4: max battle turns is 7', () => {
    expect(MAX_BATTLE_TURNS).toBe(7)
  })

  it('B5: defender maneuvers first on non-Tower', () => {
    const { battle, state } = battleOnTerrain('Plains')
    expect(battle.terrain).toBe('Plains')
    expect(battle.activeHalf).toBe('defender')
    expect(battle.activePlayerId).toBe(
      state.legions.find((l) => l.id === battle.defenderLegionId)!.playerId,
    )
  })

  it('B4: attacker maneuvers first on Tower', () => {
    const { battle, state } = battleOnTerrain('Tower')
    expect(battle.terrain).toBe('Tower')
    expect(battle.activeHalf).toBe('attacker')
    expect(battle.activePlayerId).toBe(
      state.legions.find((l) => l.id === battle.attackerLegionId)!.playerId,
    )
  })

  it('B7: after attacker finishes turn 7, time-loss fires', () => {
    const { state, battle } = battleOnTerrain('Plains')
    const defenderPlayer = state.players.find(
      (p) =>
        p.id ===
        state.legions.find((l) => l.id === battle.defenderLegionId)!.playerId,
    )!
    const scoreBefore = defenderPlayer.score

    // Place sides far apart and mark first maneuvers done
    for (const u of battle.units) {
      u.hex =
        u.legionId === battle.attackerLegionId
          ? battle.attackerEntrances[0]!
          : battle.defenderEntrances[0]!
    }
    battle.firstManeuverDone = { attacker: true, defender: true }
    battle.turn = 7
    battle.activeHalf = 'attacker'
    battle.phase = 'Strikeback'
    battle.activePlayerId = state.legions.find((l) => l.id === battle.defenderLegionId)!.playerId

    advanceBattlePhase(state, battle)

    expect(battle.done).toBe(true)
    expect(battle.timeLoss).toBe(true)
    expect(battle.winnerPlayerId).toBe(defenderPlayer.id)
    applyBattleResult(state, battle)
    expect(defenderPlayer.score).toBe(scoreBefore)
    expect(state.legions.some((l) => l.id === battle.attackerLegionId)).toBe(false)
  })

  it('B7: applyTimeLoss marks attacker units dead', () => {
    const { state, battle } = battleOnTerrain('Plains')
    applyTimeLoss(state, battle)
    expect(battle.timeLoss).toBe(true)
    expect(battle.done).toBe(true)
    for (const u of battle.units) {
      if (u.legionId === battle.attackerLegionId) {
        expect(u.hits).toBeGreaterThanOrEqual(999)
      }
    }
  })

  it('skips Strike and Strikeback when no unit has a legal target', () => {
    const { state, battle } = battleOnTerrain('Plains')
    // Park each side on its own entry hexes — typically not adjacent
    for (const u of battle.units) {
      const entrances =
        u.legionId === battle.attackerLegionId
          ? battle.attackerEntrances
          : battle.defenderEntrances
      u.hex = entrances[0]!
      u.moved = true
    }
    battle.phase = 'Move'
    battle.activeHalf = 'defender'
    battle.activePlayerId = state.legions.find((l) => l.id === battle.defenderLegionId)!.playerId

    advanceBattlePhase(state, battle)

    // Empty Strike → empty Strikeback → attacker's Move (or Summon)
    expect(battle.phase === 'Move' || battle.phase === 'Summon').toBe(true)
    expect(battle.activeHalf).toBe('attacker')
  })

  it('R: turn-4 Recruit is skipped when defender has nothing to muster', () => {
    const { state, battle } = battleOnTerrain('Plains')
    const defender = state.legions.find((l) => l.id === battle.defenderLegionId)!
    // Lone Titan cannot reinforce on Plains
    defender.creatures = [{ type: 'Titan', hits: 0 }]
    battle.units = battle.units.filter(
      (u) => u.legionId !== battle.defenderLegionId || u.creatureType === 'Titan',
    )
    for (const u of battle.units) {
      u.hex =
        u.legionId === battle.attackerLegionId
          ? battle.attackerEntrances[0]!
          : battle.defenderEntrances[0]!
    }
    battle.firstManeuverDone = { attacker: true, defender: true }
    battle.turn = 3
    battle.activeHalf = 'attacker'
    battle.phase = 'Strikeback'
    battle.defenderReinforced = false
    battle.activePlayerId = state.legions.find((l) => l.id === battle.defenderLegionId)!.playerId

    advanceBattlePhase(state, battle)

    expect(battle.turn).toBe(4)
    expect(battle.phase).toBe('Move')
    expect(battle.defenderReinforced).toBe(true)
    expect(battle.activeHalf).toBe('defender')
  })

  it('U: Summon is skipped when attacker has no summonable donor', () => {
    const { state, battle } = battleOnTerrain('Plains')
    for (const u of battle.units) {
      u.hex =
        u.legionId === battle.attackerLegionId
          ? battle.attackerEntrances[0]!
          : battle.defenderEntrances[0]!
    }
    battle.firstManeuverDone = { attacker: true, defender: true }
    // Opening stacks: Angel is in the Titan legion (attacker) — no other donor
    battle.summonState = 'firstBlood'
    battle.pendingSummon = true
    battle.attackerSummoned = false
    battle.denySummon = false
    battle.activeHalf = 'defender'
    battle.phase = 'Strikeback'
    battle.activePlayerId = state.legions.find((l) => l.id === battle.defenderLegionId)!.playerId

    advanceBattlePhase(state, battle)

    expect(battle.activeHalf).toBe('attacker')
    expect(battle.phase).toBe('Move')
    expect(battle.pendingSummon).toBe(false)
    expect(battle.summonState).toBe('tooLate')
  })
})
