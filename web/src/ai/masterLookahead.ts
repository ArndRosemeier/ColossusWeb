/** Hard-only, bounded two-future-turn movement/muster expectimax.
 * Enemy battles are risk estimates, never fabricated won combats or casualties.
 * Legacy musterSearch research modes deliberately retain their old scoring: routing
 * them here would change Normal/Easy. This is the ONE production Hard-depth entry.
 */
import { listAllMoves, listMovePreview } from '../engine/movement'
import { applyRecruit, bestRecruit, bestRecruitAt, compositionDevelopmentValue, intrinsicMusterValue, scoreRecruitOption } from '../engine/recruit'
import type { GameState, Legion } from '../engine/types'
import type { AiProfile } from './profiles'
import type { ScoredMove } from './evaluateMove'
import { estimateBattleOutcome, legionHasTitan } from './battleEstimate'
import { candidateReachRollMasks, type SpatialCache } from './boardSpatial'

export interface MasterSearchOptions {
  depth?: 1 | 2
  maxNodes?: number
  candidateLimit?: number
  destinationsPerRoll?: number
  maxGeneratedMoves?: number
  maxMovementQueries?: number
  compareHold?: boolean
}
export const HARD_MASTER_SEARCH = Object.freeze({ depth: 2 as const, maxNodes: 600, candidateLimit: 3, destinationsPerRoll: 2, maxGeneratedMoves: 6000, maxMovementQueries: 4096 })
export interface MasterSearchDiagnostics {
  depth: number
  reachedDepth: number
  nodes: number
  memoHits: number
  expandedFutureMusters: number
  movementQueries: number
  generatedMoves: number
  futureRecruitCounts: Record<string, number>
  exhausted: boolean
  completeCandidates: number
}
export interface MasterCandidateValue {
  move: ScoredMove
  utility: number
  expectedArmyQuality: number
  currentMusters: string[]
  holdArmyQuality: number | null
}
export interface MasterSearchResult {
  best: MasterCandidateValue | null
  candidates: MasterCandidateValue[]
  diagnostics: MasterSearchDiagnostics
}

/** Same-player legions share a movement die: union their winning roll events.
 * Occupied-target normal paths currently produce nested suffix masks, but the
 * representation also handles disjoint events without assuming that property.
 */
export function combineWinningRolls(threats: readonly { playerId: string; mask: number }[]): number {
  const players = new Map<string, number>()
  for (const threat of threats) {
    if (!Number.isInteger(threat.mask) || threat.mask < 0 || threat.mask > 63) throw new Error('Invalid enemy roll mask')
    players.set(threat.playerId, (players.get(threat.playerId) ?? 0) | threat.mask)
  }
  let survive = 1
  for (const mask of players.values()) {
    let wins = 0
    for (let roll = 0; roll < 6; roll++) if (mask & (1 << roll)) wins++
    survive *= 1 - wins / 6
  }
  return survive
}

function composition(legion: Legion): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const c of legion.creatures) counts[c.type] = (counts[c.type] ?? 0) + 1
  return counts
}
function legionQuality(state: GameState, legion: Legion): number {
  const owner = state.players.find((p) => p.id === legion.playerId)!
  let quality = 0
  for (const c of legion.creatures) {
    const def = state.variant.creatures[c.type]
    if (!def) throw new Error(`Unknown master-search creature: ${c.type}`)
    quality += c.type === 'Titan' ? owner.titanPower * def.skill : intrinsicMusterValue(state, c.type)
  }
  return quality + 0.15 * compositionDevelopmentValue(state, composition(legion))
}
function armyQuality(state: GameState, owner: string): number {
  return state.legions.filter((l) => l.playerId === owner).reduce((sum, l) => sum + legionQuality(state, l), 0)
}
function enemyOn(state: GameState, hex: string, owner: string): boolean {
  return state.legions.some((l) => l.playerId !== owner && l.hexLabel === hex)
}

/** Greedy global current muster, using the SAME legal/provider/scorer as actual AI.
 * Every eligible friendly stack competes for stock; only cloned data is mutated.
 */
function landAndMuster(state: GameState, legion: Legion, hex: string, future: boolean): { state: GameState; legion: Legion; musters: string[] } {
  const next: GameState = { ...state, caretaker: { ...state.caretaker },
    legions: state.legions.map((l) => l.playerId === legion.playerId ? {
      ...l, creatures: l.creatures.map((c) => ({ ...c })),
      ...(future ? { moved: false, recruited: false, musteredThisTurn: null } : {}),
      ...(l.id === legion.id ? { hexLabel: hex, moved: future || l.moved || hex !== l.hexLabel,
        recruited: false, musteredThisTurn: null } : {}),
    } : l) }
  const musters: string[] = []
  for (;;) {
    let best: { legion: Legion; type: string; score: number } | null = null
    for (const friend of next.legions.filter((l) => l.playerId === legion.playerId)) {
      if (enemyOn(next, friend.hexLabel, friend.playerId)) continue
      const type = bestRecruit(next, friend)
      if (!type) continue
      const score = scoreRecruitOption(next, type, friend.hexLabel, friend)
      if (!best || score > best.score) best = { legion: friend, type, score }
    }
    if (!best) break
    applyRecruit(next, best.legion.id, best.type)
    musters.push(`${best.legion.id}:${best.type}`)
  }
  return { state: next, legion: next.legions.find((l) => l.id === legion.id)!, musters }
}

function memoKey(state: GameState, legion: Legion, depth: number): string {
  // Decision-local: variant and personality are fixed. Include ALL mutable movement,
  // combat/support and stock inputs, not just mover/hex/depth as old research did.
  return JSON.stringify([depth, legion.id, state.turnNumber, state.caretaker,
    state.players.map((p) => [p.id, p.score, p.titanPower, p.hasTeleported]),
    state.legions.map((l) => [l.id, l.playerId, l.hexLabel, l.moved, l.recruited,
      l.creatures.map((c) => [c.type, c.hits]).sort()])])
}

export function searchMasterMoves(state: GameState, ranked: readonly ScoredMove[], profile: AiProfile,
  options: MasterSearchOptions = {},
): MasterSearchResult {
  const limits = { ...HARD_MASTER_SEARCH, ...options }
  if (![1, 2].includes(limits.depth) || !Number.isInteger(limits.maxNodes) || limits.maxNodes < 1 || limits.maxNodes > 10000 ||
    !Number.isInteger(limits.candidateLimit) || limits.candidateLimit < 1 || limits.candidateLimit > 8 ||
    !Number.isInteger(limits.destinationsPerRoll) || limits.destinationsPerRoll < 1 || limits.destinationsPerRoll > 6 || !Number.isInteger(limits.maxGeneratedMoves) || limits.maxGeneratedMoves < 1 || limits.maxGeneratedMoves > 100000 ||
    !Number.isInteger(limits.maxMovementQueries) || limits.maxMovementQueries < 1 || limits.maxMovementQueries > 100000) {
    throw new Error('Invalid master lookahead budget')
  }
  const diagnostics: MasterSearchDiagnostics = { depth: limits.depth, reachedDepth: 0, nodes: 0, memoHits: 0,
    expandedFutureMusters: 0, movementQueries: 0, generatedMoves: 0, futureRecruitCounts: {}, exhausted: false, completeCandidates: 0 }
  const result: MasterSearchResult = { best: null, candidates: [], diagnostics }
  if (state.phase !== 'Move' || state.movementRoll == null) return result
  const owner = state.players[state.activePlayerIndex].id
  // Current unresolved battles require casualties/stock we deliberately do not invent.
  if (state.legions.some((l) => l.playerId === owner && enemyOn(state, l.hexLabel, owner))) return result
  const shortlist = ranked.filter((m) => !m.forcedSplit && !enemyOn(state, m.hex, owner)).slice(0, limits.candidateLimit)
  const baseQuality = armyQuality(state, owner)
  const memo = new Map<string, number>()
  const reach: SpatialCache = { reachCounts: new Map(), candidateReach: new Map(), nextTurnMemo: new Map(), musterMemo: new Map(), movementQueries: 0 }

  function movementQuery(): boolean {
    if (reach.movementQueries + diagnostics.movementQueries >= limits.maxMovementQueries) {
      diagnostics.exhausted = true
      return false
    }
    diagnostics.movementQueries++
    return true
  }
  function survival(position: GameState, mover: Legion): number | null {
    const threats: { playerId: string; mask: number }[] = []
    for (const enemy of position.legions) {
      if (enemy.playerId === mover.playerId) continue
      const mask = candidateReachRollMasks(position, enemy, reach).get(mover.hexLabel) ?? 0
      if (reach.movementQueries + diagnostics.movementQueries > limits.maxMovementQueries) {
        diagnostics.exhausted = true
        return null
      }
      if (!mask || estimateBattleOutcome(position, enemy, mover, mover.hexLabel).ratio < 1.15) continue
      threats.push({ playerId: enemy.playerId, mask })
    }
    return combineWinningRolls(threats)
  }
  function visit(position: GameState, mover: Legion, depth: number): number | null {
    const key = memoKey(position, mover, depth)
    const hit = memo.get(key)
    if (hit !== undefined) { diagnostics.memoHits++; return hit }
    if (diagnostics.nodes >= limits.maxNodes) { diagnostics.exhausted = true; return null }
    diagnostics.nodes++
    diagnostics.reachedDepth = Math.max(diagnostics.reachedDepth, limits.depth - depth)
    const quality = armyQuality(position, owner)
    const alive = survival(position, mover)
    if (alive === null) return null
    const deathValue = legionHasTitan(mover) ? -1000 : quality - legionQuality(position, mover)
    if (depth === 0 || alive === 0) {
      const value = alive * quality + (1 - alive) * deathValue
      memo.set(key, value)
      return value
    }
    let expected = 0
    const ready: Legion = { ...mover, moved: false, recruited: false, teleported: false }
    const readyState = { ...position, legions: position.legions.map((l) => l.id === mover.id ? ready : l) }
    for (let roll = 1; roll <= 6; roll++) {
      if (!movementQuery()) return null
      const legal = [...listMovePreview(readyState, ready, roll)]
      const frontier: { hex: string; rank: number }[] = []
      for (const [hex] of legal) {
        if (diagnostics.generatedMoves >= limits.maxGeneratedMoves ||
          reach.movementQueries + diagnostics.movementQueries > limits.maxMovementQueries) {
          diagnostics.exhausted = true
          return null
        }
        diagnostics.generatedMoves++
        if (enemyOn(readyState, hex, owner)) continue
        const recruit = bestRecruitAt(readyState, ready, hex)
        frontier.push({ hex, rank: recruit ? scoreRecruitOption(readyState, recruit, hex, ready) : 0 })
      }
      const choices = frontier.sort((a, b) => b.rank - a.rank).slice(0, limits.destinationsPerRoll)
        .map(({ hex }) => landAndMuster(readyState, ready, hex, true))
      let best = -Infinity
      if (choices.length === 0) {
        // No fabricated winning combat: combat-only future routes get zero mover
        // survival credit. A genuinely immobile legion can legally remain, no muster.
        best = legal.length ? deathValue : quality
      }
      for (const choice of choices) {
        diagnostics.expandedFutureMusters += choice.musters.length
        for (const muster of choice.musters) {
          const type = muster.slice(muster.indexOf(':') + 1)
          diagnostics.futureRecruitCounts[type] = (diagnostics.futureRecruitCounts[type] ?? 0) + 1
        }
        const value = visit(choice.state, choice.legion, depth - 1)
        if (value === null) return null // incomplete chance nodes cannot earn positive value
        best = Math.max(best, value)
      }
      expected += best / 6
    }
    const value = alive * (0.85 * expected + 0.15 * quality) + (1 - alive) * deathValue
    memo.set(key, value)
    return value
  }

  for (const move of shortlist) {
    const legion = state.legions.find((l) => l.id === move.legionId)
    if (!legion || legion.playerId !== owner) throw new Error('Master lookahead move has no owned legion')
    if (!movementQuery()) { result.candidates = []; break }
    const legal = listAllMoves(state, legion, state.movementRoll).get(move.hex)
    if (!legal || legal.teleport !== move.teleport) throw new Error('Master lookahead received stale/illegal candidate')
    const grown = landAndMuster(state, legion, move.hex, false)
    const value = visit(grown.state, grown.legion, limits.depth)
    if (value === null) { result.candidates = []; result.best = null; break }
    let holdArmyQuality: number | null = null
    if (limits.compareHold) {
      const held = landAndMuster(state, legion, legion.hexLabel, false)
      holdArmyQuality = visit(held.state, held.legion, limits.depth)
      if (holdArmyQuality === null) { result.candidates = []; result.best = null; break }
    }
    diagnostics.completeCandidates++
    result.candidates.push({ move, expectedArmyQuality: value,
      utility: (value - (holdArmyQuality ?? baseQuality)) * profile.recruitPreference + move.score * 0.1, currentMusters: grown.musters, holdArmyQuality })
  }
  if (!diagnostics.exhausted) result.best = [...result.candidates].sort((a, b) => b.utility - a.utility)[0] ?? null
  diagnostics.movementQueries += reach.movementQueries
  return result
}
