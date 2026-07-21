/**
 * AI split composition — Colossus SimpleAI.chooseCreaturesToSplitOut /
 * findWeakestTwoCritters, with development-aware surplus (keep recruiters
 * needed for the next upgrade; spit fodder you no longer need to muster up).
 */
import { intrinsicMusterValue, listDevelopmentEdges } from '../engine/recruit'
import type { GameState, Legion } from '../engine/types'

function countByType(types: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const t of types) {
    counts[t] = (counts[t] ?? 0) + 1
  }
  return counts
}

/** Max recruiters of each type still useful for any primary upgrade edge. */
export function maxRecruitersNeeded(state: GameState): Map<string, number> {
  const needed = new Map<string, number>()
  for (const e of listDevelopmentEdges(state)) {
    needed.set(e.recruiter, Math.max(needed.get(e.recruiter) ?? 0, e.needed))
  }
  return needed
}

/**
 * Higher = more willing to spit this creature into the child stack.
 * Never spit Titan / prefer keeping Lords; prefer surplus over muster-critical
 * copies; among equals prefer lower combat value and matching pairs.
 */
export function spitDesirability(
  state: GameState,
  type: string,
  remainingOfType: number,
  neededOfType: number,
): number {
  const def = state.variant.creatures[type]
  if (!def || type === 'Titan' || def.lord) return -100_000
  if (def.demilord) return -5_000

  const surplus =
    neededOfType <= 0 ? remainingOfType : Math.max(0, remainingOfType - neededOfType)
  // Surplus copies are the ones you no longer need to muster higher units
  const surplusBonus = surplus > 0 ? 2_000 + surplus * 50 : 0
  return surplusBonus - intrinsicMusterValue(state, type)
}

/**
 * Choose exactly two creature types to split off a height-7 (or forced taller)
 * legion. Never includes Titan; prefers weakest / muster-surplus units and
 * matching pairs when scores tie (Colossus findWeakestTwoCritters).
 */
export function chooseCreaturesToSplitOut(state: GameState, legion: Legion): string[] {
  const needed = maxRecruitersNeeded(state)
  const pool = legion.creatures.map((c) => c.type).filter((t) => t !== 'Titan')
  if (pool.length < 2) return []

  const remaining = countByType(pool)
  const picked: string[] = []

  for (let n = 0; n < 2; n++) {
    let bestType: string | null = null
    let bestScore = -Infinity
    for (const type of Object.keys(remaining)) {
      const have = remaining[type] ?? 0
      if (have <= 0) continue
      let score = spitDesirability(state, type, have, needed.get(type) ?? 0)
      // Prefer completing a matching pair (Colossus: two of the same when equal)
      if (picked.length === 1 && picked[0] === type) score += 25
      if (score > bestScore) {
        bestScore = score
        bestType = type
      }
    }
    if (!bestType) break
    picked.push(bestType)
    remaining[bestType] = (remaining[bestType] ?? 1) - 1
    if (remaining[bestType]! <= 0) delete remaining[bestType]
  }

  return picked.length === 2 ? picked : []
}
