/**
 * AI split composition — Colossus SimpleAI.chooseCreaturesToSplitOut /
 * findWeakestTwoCritters, with development-aware surplus (keep recruiters
 * needed for the next upgrade; spit fodder you no longer need to muster up).
 */
import { compositionDevelopmentValue, intrinsicMusterValue, listAvailableDevelopmentEdges } from '../engine/recruit'
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
  for (const e of listAvailableDevelopmentEdges(state)) {
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
  if (!def) throw new Error(`Unknown split creature: ${type}`)
  if (type === 'Titan' || def.lord) return -100_000
  if (def.demilord) return -5_000

  // A terminal creature is a completed investment, not an expendable recruiter.
  const surplus = neededOfType <= 0 ? 0 : Math.max(0, remainingOfType - neededOfType)
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

/** Opening 4:4: keep one lord each and develop matching basic recruiting groups.
 * Enumerates at most 20 triples in the standard opening; randomness only breaks ties.
 */
export function chooseOpeningSplit(state: GameState, legion: Legion, childLord: string, rng: () => number): string[] {
  const pool = legion.creatures.filter((c) => !state.variant.creatures[c.type].lord)
  const options: { child: string[]; score: number }[] = []
  const seen = new Set<string>()
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    for (let k = j + 1; k < pool.length; k++) {
      const child = [childLord, pool[i].type, pool[j].type, pool[k].type]
      const key = [...child].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      const parent = legion.creatures.map((c) => c.type)
      for (const type of child) parent.splice(parent.indexOf(type), 1)
      const childCounts = countByType(child)
      const parentCounts = countByType(parent)
      const development = compositionDevelopmentValue(state, childCounts) + compositionDevelopmentValue(state, parentCounts)
      const pairs = [...Object.values(childCounts), ...Object.values(parentCounts)].filter((n) => n >= 2).length
      const value = (types: string[]) => types.reduce((sum, type) => sum + intrinsicMusterValue(state, type), 0)
      options.push({ child, score: development + pairs * 2 - Math.abs(value(child) - value(parent)) * 0.2 })
    }
  }
  if (options.length === 0) throw new Error('No legal opening split composition')
  const best = Math.max(...options.map((o) => o.score))
  const ties = options.filter((o) => o.score === best)
  return ties[Math.floor(rng() * ties.length)]!.child
}
