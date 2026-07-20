import { legionCombatValue } from './legionStrength'
import type { GameState, Legion } from '../engine/types'

/** Colossus SimpleAI ratio buckets. */
export type BattleOutcome =
  | 'winMinimal'
  | 'winHeavy'
  | 'draw'
  | 'loseHeavy'
  | 'lose'

export const RATIO_WIN_MINIMAL = 1.3
export const RATIO_WIN_HEAVY = 1.15
export const RATIO_DRAW = 0.85
export const RATIO_LOSE_HEAVY = 0.7

export const LOSE_LEGION_SCORE = -10_000

/**
 * Estimate engagement on `hexLabel` using location-aware combat values
 * (includes summon / reinforce extras).
 */
export function estimateBattleOutcome(
  state: GameState,
  attacker: Legion,
  defender: Legion,
  hexLabel: string,
): { outcome: BattleOutcome; ratio: number; attackValue: number; defendValue: number } {
  const attackValue = legionCombatValue(state, attacker, hexLabel, 'attack', {
    engagementExtras: true,
  })
  const defendValue = Math.max(
    1,
    legionCombatValue(state, defender, hexLabel, 'defend', { engagementExtras: true }),
  )
  const ratio = attackValue / defendValue

  let outcome: BattleOutcome
  if (ratio >= RATIO_WIN_MINIMAL) outcome = 'winMinimal'
  else if (ratio >= RATIO_WIN_HEAVY) outcome = 'winHeavy'
  else if (ratio >= RATIO_DRAW) outcome = 'draw'
  else if (ratio >= RATIO_LOSE_HEAVY) outcome = 'loseHeavy'
  else outcome = 'lose'

  return { outcome, ratio, attackValue, defendValue }
}

export function legionPointValue(state: GameState, legion: Legion): number {
  const owner = state.players.find((p) => p.id === legion.playerId)
  let total = 0
  for (const c of legion.creatures) {
    const t = state.variant.creatures[c.type]
    if (!t) continue
    if (c.type === 'Titan') total += (owner?.titanPower ?? 6) * t.skill
    else total += t.power * t.skill
  }
  return total
}

export function legionHasTitan(legion: Legion): boolean {
  return legion.creatures.some((c) => c.type === 'Titan')
}
