/**
 * Experimental board terms on top of spatial — isolated so each can be
 * A/B’d against the reference evaluator.
 */
import { listAllMoves } from '../engine/movement'
import {
  buildPrimaryRecruitEdges,
  intrinsicMusterValue,
  listDevelopmentEdges,
} from '../engine/recruit'
import type { GameState, Legion } from '../engine/types'
import { estimateBattleOutcome, legionHasTitan, legionPointValue } from './battleEstimate'
import { legalFirstExits } from './boardSpatial'

function countByType(legion: Legion): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const c of legion.creatures) {
    counts[c.type] = (counts[c.type] ?? 0) + 1
  }
  return counts
}

/**
 * Terrains where this legion’s next incomplete upgrade lives, weighted by
 * how close the stack is to unlocking it.
 */
export function nextUpgradeTerrainValues(
  state: GameState,
  legion: Legion,
): Map<string, number> {
  const counts = countByType(legion)
  const wanted = new Map<string, number>()
  for (const e of listDevelopmentEdges(state)) {
    const have = counts[e.recruiter] ?? 0
    if (have <= 0 || have >= e.needed) continue
    const fromVal = intrinsicMusterValue(state, e.recruiter)
    const toVal = intrinsicMusterValue(state, e.recruit)
    if (toVal <= fromVal) continue
    const closeness = have / e.needed
    const prize = toVal * closeness
    for (const terrain of Object.values(state.variant.terrains)) {
      const hits = buildPrimaryRecruitEdges(terrain).some(
        (edge) => edge.from === e.recruiter && edge.to === e.recruit,
      )
      if (!hits) continue
      wanted.set(terrain.name, Math.max(wanted.get(terrain.name) ?? 0, prize))
    }
  }
  return wanted
}

/**
 * Walk toward the biome of the next muster upgrade, even when this hex
 * (and most next-turn rolls) cannot recruit it yet.
 */
export function pipelineScore(state: GameState, legion: Legion, hexLabel: string): number {
  const wanted = nextUpgradeTerrainValues(state, legion)
  if (wanted.size === 0) return 0
  const board = state.variant.board
  const start = board.hexByLabel[hexLabel]
  if (!start) return 0

  let score = 0
  const here = wanted.get(start.terrain)
  if (here != null) score += here * 0.16

  const visited = new Set<string>([hexLabel])
  let frontier = [hexLabel]
  for (let dist = 1; dist <= 3; dist++) {
    const next: string[] = []
    for (const cur of frontier) {
      const h = board.hexByLabel[cur]
      if (!h) continue
      for (const n of legalFirstExits(h)) {
        if (visited.has(n)) continue
        visited.add(n)
        next.push(n)
        const terrain = board.hexByLabel[n]?.terrain
        if (!terrain) continue
        const prize = wanted.get(terrain)
        if (prize == null) continue
        score += prize * (0.2 / dist)
      }
    }
    frontier = next
  }
  return score
}

/**
 * If a non-Titan unmoved friend can also reach this winning fight on the
 * current roll, the Titan should leave it to them.
 */
export function titanDelegationPenalty(
  state: GameState,
  legion: Legion,
  hex: string,
  roll: number,
): number {
  if (!legionHasTitan(legion)) return 0
  const enemy = state.legions.find((l) => l.hexLabel === hex && l.playerId !== legion.playerId)
  if (!enemy) return 0
  const { outcome } = estimateBattleOutcome(state, legion, enemy, hex)
  if (outcome !== 'winMinimal' && outcome !== 'winHeavy') return 0

  for (const friend of state.legions) {
    if (friend.playerId !== legion.playerId || friend.id === legion.id) continue
    if (friend.moved || legionHasTitan(friend)) continue
    if (!listAllMoves(state, friend, roll).has(hex)) continue
    const friendFight = estimateBattleOutcome(state, friend, enemy, hex)
    if (friendFight.outcome !== 'winMinimal' && friendFight.outcome !== 'winHeavy') continue
    return Math.min(90, 0.55 * legionPointValue(state, enemy) + 25)
  }
  return 0
}
