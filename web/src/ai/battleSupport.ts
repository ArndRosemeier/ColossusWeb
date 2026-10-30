/** Deterministic battle support policy shared by real AI and sampled futures. */
import { listBattleReinforceOptions, listBattleSummonSources, type BattleSupportCommand } from '../engine/battle'
import type { BattleState, GameState } from '../engine/types'
import { creatureCombatValue } from './legionStrength'
import { planReinforcement, planSummon } from './supportPlanning'

export function pickBattleSupport(state: GameState, battle: BattleState): BattleSupportCommand {
  if (battle.phase === 'Recruit') {
    const defender = state.legions.find((l) => l.id === battle.defenderLegionId)!
    const creatureType = planReinforcement(listBattleReinforceOptions(state, battle), defender.hexLabel,
      (type, hex) => creatureCombatValue(state, type, hex))
    return creatureType ? { type: 'battleReinforce', creatureType } : { type: 'battleSkipReinforce' }
  }
  if (battle.phase === 'Summon') {
    const attacker = state.legions.find((l) => l.id === battle.attackerLegionId)!
    const best = planSummon(state, attacker, (type, hex) => creatureCombatValue(state, type, hex),
      listBattleSummonSources(state, battle))
    return best ? { type: 'battleSummon', fromLegionId: best.fromLegionId } : { type: 'battleSkipSummon' }
  }
  throw new Error('Not a battle support phase')
}
