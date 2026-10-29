/** One bounded, deterministic HOLD-versus-split decision. No game-state mutation. */
import { listMovePreview } from '../engine/movement'
import { compositionDevelopmentValue, intrinsicMusterValue, listRecruitOptionsAt, scoreRecruitOption } from '../engine/recruit'
import type { GameState, Legion } from '../engine/types'
import { buildSpatialCache, incomingThreatScore, type SpatialCache } from './boardSpatial'
import { estimateBattleOutcome, legionPointValue } from './battleEstimate'
import { chooseCreaturesToSplitOut } from './splitChoice'
import type { AiProfile } from './profiles'

/** Optimization limits only: an unfinished safety screen always chooses HOLD. */
export interface SplitPlanningBudget {
  maxPlans?: number
  destinationsPerRoll?: number
}
export interface SplitPlan {
  childCreatures: string[] | null
  score: number
  holdScore: number
  candidates: number
  plans: number
  exhausted: boolean
  movementQueries: number
}

function counts(legion: Legion): Record<string, number> {
  const result: Record<string, number> = {}
  for (const c of legion.creatures) result[c.type] = (result[c.type] ?? 0) + 1
  return result
}

/** A new unit must improve combat quality or advance an available higher recruiting line. */
function growthOptions(state: GameState, legion: Legion, hex: string): { type: string; value: number }[] {
  const before = counts(legion)
  const strongest = Math.max(0, ...legion.creatures
    .filter((c) => !state.variant.creatures[c.type].lord)
    .map((c) => intrinsicMusterValue(state, c.type)))
  const development = compositionDevelopmentValue(state, before, strongest)
  return listRecruitOptionsAt(state, legion, hex).flatMap((type) => {
    const after = { ...before, [type]: (before[type] ?? 0) + 1 }
    if (intrinsicMusterValue(state, type) <= strongest &&
      compositionDevelopmentValue(state, after, strongest) <= development) return []
    return [{ type, value: scoreRecruitOption(state, type, hex, legion) }]
  })
}

/** Attainable joint growth: the two pieces compete for the same caretaker supply. */
export function jointSplitGrowth(state: GameState, parent: Legion, parentHex: string,
  child: Legion, childHex: string,
): number {
  const none = { type: '', value: 0 }
  const parents = parentHex === parent.hexLabel ? [none] : [none, ...growthOptions(state, parent, parentHex)]
  const children = childHex === child.hexLabel ? [none] : [none, ...growthOptions(state, child, childHex)]
  let best = 0
  for (const p of parents) for (const c of children) {
    if (p.type && p.type === c.type && (state.caretaker[p.type] ?? 0) < 2) continue
    best = Math.max(best, p.value + c.value)
  }
  return best
}

function pairState(state: GameState, parent: Legion, child: Legion): GameState {
  return { ...state, legions: [...state.legions.map((l) => l.id === parent.id ? parent : l), child] }
}

function safeAt(state: GameState, legion: Legion, hex: string, cache: SpatialCache): boolean {
  for (const enemy of state.legions) {
    if (enemy.playerId === legion.playerId || enemy.hexLabel !== hex) continue
    // A merely even fight is not a conservative survival plan for a split child.
    if (estimateBattleOutcome(state, legion, enemy, hex).ratio < 1.3) return false
  }
  // Even one roll of overwhelming incoming danger matters. Titan's multiplier is higher.
  return incomingThreatScore(state, legion, hex, cache) <= Math.max(1, legionPointValue(state, legion)) * 0.2
}

/** Unique legal two-creature multisets, with the composition-preserving choice first. */
function candidatesFor(state: GameState, legion: Legion): string[][] {
  const preferred = chooseCreaturesToSplitOut(state, legion)
  const candidates: string[][] = []
  const seen = new Set<string>()
  const add = (types: string[]) => {
    const key = [...types].sort().join('|')
    if (!seen.has(key)) { seen.add(key); candidates.push(types) }
  }
  if (preferred.length === 2) add(preferred)
  for (let i = 0; i < legion.creatures.length; i++) {
    for (let j = i + 1; j < legion.creatures.length; j++) {
      const types = [legion.creatures[i].type, legion.creatures[j].type]
      if (!types.includes('Titan')) add(types)
    }
  }
  return candidates
}

export function planOptionalSplit(state: GameState, legion: Legion, profile: AiProfile,
  budget: SplitPlanningBudget = {},
): SplitPlan {
  const maxPlans = budget.maxPlans ?? 1024
  const destinations = budget.destinationsPerRoll ?? 4
  if (!Number.isInteger(maxPlans) || maxPlans < 1 || maxPlans > 8192 ||
    !Number.isInteger(destinations) || destinations < 1 || destinations > 12) {
    throw new Error('Invalid split planning budget')
  }
  const result: SplitPlan = { childCreatures: null, score: 0, holdScore: 0,
    candidates: 0, plans: 0, exhausted: false, movementQueries: 0 }
  if (legion.creatures.length !== 7 || legion.splitThisTurn || state.turnNumber === 1) return result
  for (const c of legion.creatures) {
    if (!state.variant.creatures[c.type]) throw new Error(`Unknown split creature: ${c.type}`)
  }
  const cache = buildSpatialCache(state)
  let previewQueries = 0
  const moves = (position: GameState, piece: Legion, roll: number) => {
    previewQueries++
    return listMovePreview(position, piece, roll)
  }
  // HOLD retains the original composition and may stay while another legion moves.
  // Only actual legal endpoints compete with that baseline, never imaginary open exits.
  for (let roll = 1; roll <= 6; roll++) {
    let risk = incomingThreatScore(state, legion, legion.hexLabel, cache)
    for (const [hex] of moves(state, legion, roll)) {
      if (safeAt(state, legion, hex, cache)) { risk = 0; break }
    }
    result.holdScore -= risk / 6
  }
  result.score = result.holdScore
  const originalDevelopment = compositionDevelopmentValue(state, counts(legion))
  for (const childTypes of candidatesFor(state, legion)) {
    result.candidates++
    const remaining = [...legion.creatures]
    const childCreatures = childTypes.map((type) => remaining.splice(remaining.findIndex((c) => c.type === type), 1)[0])
    const parent: Legion = { ...legion, creatures: remaining, moved: false, splitThisTurn: true }
    const child: Legion = { ...legion, id: `${legion.id}:split-plan`, creatures: childCreatures,
      moved: false, splitThisTurn: false, splitParentId: legion.id }
    const split = pairState(state, parent, child)
    let growth = 0
    let complete = true
    for (let roll = 1; roll <= 6; roll++) {
      // Both pieces may stay only if they recombine, which is HOLD, not growth.
      const choices = (piece: Legion) => [{ hex: piece.hexLabel, growth: 0, teleport: false },
        ...[...moves(split, piece, roll)].map(([hex, info]) =>
          ({ hex, growth: Math.max(0, ...growthOptions(split, piece, hex).map((o) => o.value)), teleport: info.teleport }))
          .sort((a, b) => b.growth - a.growth).slice(0, destinations)]
      const parentChoices = choices(parent)
      const childChoices = choices(child)
      const plans = parentChoices.flatMap((p) => childChoices
        .filter((c) => c.hex !== p.hex && !(c.teleport && p.teleport))
        .map((c) => ({ p, c, growth: jointSplitGrowth(split, parent, p.hex, child, c.hex) })))
        .sort((a, b) => b.growth - a.growth)
      let safeGrowth: number | null = null
      for (const plan of plans) {
        if (result.plans >= maxPlans) { complete = false; result.exhausted = true; break }
        result.plans++
        const p = { ...parent, hexLabel: plan.p.hex }
        const c = { ...child, hexLabel: plan.c.hex }
        const projected = pairState(state, p, c)
        if (!safeAt(projected, p, p.hexLabel, cache) || !safeAt(projected, c, c.hexLabel, cache)) continue
        safeGrowth = plan.growth
        break
      }
      if (!complete) break
      // Optional splitting must not purchase growth with a forced loss on ANY roll,
      // especially a Titan loss. HOLD is available before committing the split.
      if (safeGrowth == null) { complete = false; break }
      growth += safeGrowth / 6
    }
    if (result.exhausted) break
    if (!complete || growth <= 0) continue
    const developmentLoss = Math.max(0, originalDevelopment -
      compositionDevelopmentValue(state, counts(parent)) - compositionDevelopmentValue(state, counts(child)))
    const investment = childTypes.reduce((sum, type) => sum + intrinsicMusterValue(state, type), 0)
    const score = growth * profile.recruitPreference - developmentLoss * 1.5 - investment * 0.15
    if (score > result.score + 1) { result.score = score; result.childCreatures = childTypes }
  }
  result.movementQueries = cache.movementQueries + previewQueries
  return result
}
