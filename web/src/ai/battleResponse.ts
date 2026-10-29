import type { BattleState, BattleUnit, GameState } from '../engine/types'
import { battleLand, MAX_BATTLE_TURNS } from '../engine/battle'
import { legalBattleMoves } from '../engine/battleMovement'
import { getStrikeDice, getStrikeNumber, getUnitPower, isUnitAlive, legalStrikes } from '../engine/battleStrike'
import { hazardDamageToCreature, meleeNeighbors } from '../engine/battleland'
import { strikeExpectations } from './battleProbability'

export interface BattlePlannerOptions {
  /** Non-deployment candidate moves, in addition to the complete hold position. */
  candidateLimit: number
  /** Maximum enemy landing/strike evaluations across the entire decision. */
  maxResponseNodes: number
}

export const NORMAL_BATTLE_PLANNER: Readonly<BattlePlannerOptions> = Object.freeze({ candidateLimit: 8, maxResponseNodes: 2048 })

export function battlePlannerOptions(options: Partial<BattlePlannerOptions> = {}): BattlePlannerOptions {
  const resolved = { ...NORMAL_BATTLE_PLANNER, ...options }
  if (!Number.isInteger(resolved.candidateLimit) || resolved.candidateLimit < 1 || resolved.candidateLimit > 32 ||
      !Number.isInteger(resolved.maxResponseNodes) || resolved.maxResponseNodes < 1 || resolved.maxResponseNodes > 16384) {
    throw new Error('Invalid tactical planner budget')
  }
  return resolved
}

export interface BattleResponseBudget { nodes: number; limit: number }

/**
 * Bounded legal enemy maneuver response, conditional on surviving the current combat.
 * Independent best replies may contest the same landing: deliberately pessimistic,
 * not a claim of a joint minimax or stochastic rollout. Own screens/contact/LOS matter.
 */
export function legalEnemyResponse(
  state: GameState,
  battle: BattleState,
  budget: BattleResponseBudget,
  keepValue: (unit: BattleUnit) => number,
) {
  const land = battleLand(state, battle)
  const ourId = battle.activePlayerId
  const nextTurn = battle.turn + Number(battle.activeHalf === 'attacker')
  if (nextTurn > MAX_BATTLE_TURNS) return { loss: 0, titanRisk: 0, titanDamage: 0, titanDoomed: false, complete: true }
  // Terrain damage precedes our Strike. Its casualties cannot maneuver next half.
  const units = battle.units.map(unit => {
    const creature = state.variant.creatures[unit.creatureType]
    const damage = unit.hex && creature ? hazardDamageToCreature(land.hexByLabel[unit.hex].terrain, creature) : 0
    return { ...unit, hits: Math.max(0, unit.hits + damage), moved: false, struck: false }
  }).filter(unit => isUnitAlive(state, unit))
  const ours = units.filter(unit => unit.playerId === ourId && unit.hex)
  const enemies = units.filter(unit => unit.playerId !== ourId)
  const sim: BattleState = { ...battle, units, turn: nextTurn, phase: 'Move',
    activeHalf: battle.activeHalf === 'attacker' ? 'defender' : 'attacker',
    activePlayerId: enemies[0]?.playerId ?? ourId }
  // Next-half casualties still occupy cells throughout the preceding maneuver.
  const maneuver = { ...sim, units: units.map(unit => ({ ...unit })) }
  let loss = 0, titanSurvival = 1, titanDamage = 0, titanDoomed = false
  if (enemies.length > 0) for (const own of ours) {
    const damage = hazardDamageToCreature(land.hexByLabel[own.hex!].terrain, state.variant.creatures[own.creatureType])
    const before = own.hits
    own.hits = Math.max(0, own.hits + damage)
    if (damage > 0) {
      loss += keepValue(own) * damage / Math.max(1, getUnitPower(state, own) - before)
      if (own.creatureType === 'Titan') {
        titanDamage += damage
        if (!isUnitAlive(state, own)) { titanDoomed = true; titanSurvival = 0 }
      }
    }
  }
  for (const enemy of enemies) {
    const origin = enemy.hex
    const mover = maneuver.units.find(unit => unit.id === enemy.id)!
    const landings = [...(origin ? [origin] : []), ...legalBattleMoves(state, maneuver, land, mover)]
    const worst = new Map<string, { loss: number; kill: number; damage: number }>()
    for (const landing of landings) {
      if (budget.nodes >= budget.limit) return { loss, titanRisk: 1 - titanSurvival, titanDamage, titanDoomed, complete: false }
      budget.nodes++
      enemy.hex = landing
      // Next pre-strike damages the landing, too. A newly slain ordinary striker
      // still strikes this half; legalStrikes intentionally permits that.
      const originalHits = enemy.hits
      const creature = state.variant.creatures[enemy.creatureType]
      enemy.hits = Math.max(0, originalHits + hazardDamageToCreature(land.hexByLabel[landing].terrain, creature))
      const targets = legalStrikes(state, sim, land, enemy, true)
      for (const own of ours) {
        if (!targets.includes(own.id)) continue
        const melee = meleeNeighbors(land, landing).includes(own.hex!)
        const hp = Math.max(0, getUnitPower(state, own) - own.hits)
        const stats = strikeExpectations(getStrikeDice(state, land, enemy, own, melee), getStrikeNumber(state, enemy, own, land, melee), hp)
        const value = keepValue(own)
        const cost = value * (stats.expectedDamage / Math.max(1, hp) + stats.killProbability * (own.creatureType === 'Titan' ? 4 : 1))
        const previous = worst.get(own.id)
        worst.set(own.id, { loss: Math.max(previous?.loss ?? 0, cost), kill: Math.max(previous?.kill ?? 0, stats.killProbability), damage: Math.max(previous?.damage ?? 0, stats.expectedDamage) })
      }
      enemy.hits = originalHits
    }
    enemy.hex = origin
    // One enemy has one strike: do not charge all its alternative targets as simultaneous damage.
    loss += Math.max(0, ...[...worst.values()].map(value => value.loss))
    for (const own of ours) if (own.creatureType === 'Titan') {
      titanSurvival *= 1 - (worst.get(own.id)?.kill ?? 0)
      titanDamage += worst.get(own.id)?.damage ?? 0
    }
  }
  return { loss, titanRisk: 1 - titanSurvival, titanDamage, titanDoomed, complete: true }
}
