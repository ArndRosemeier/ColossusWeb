/** Hard-only, bounded two-future-turn movement/muster expectimax.
 * Enemy battles are risk estimates, never fabricated won combats or casualties.
 * Legacy musterSearch research modes deliberately retain their old scoring: routing
 * them here would change Normal/Easy. This is the ONE production Hard-depth entry.
 */
import { listAllMoves } from '../engine/movement'
import { canEndMovePhase } from '../engine/GameEngine'
import { applyRecruit, bestRecruit, bestRecruitAt, compositionDevelopmentValue, intrinsicMusterValue, scoreRecruitOption } from '../engine/recruit'
import type { GameCommand, GameState, Legion } from '../engine/types'
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
  holdLegionId?: string
  stopAfterHoldImprovement?: boolean
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
  futureMustersByLegion: Record<string, number>
  futureHolds: number
  companionHoldMoves: number
  exhausted: boolean
  incomplete: boolean
  completeCandidates: number
  certifiedHoldEarlyExit: boolean
}
export interface MasterCandidateValue {
  move: ScoredMove
  utility: number
  expectedArmyQuality: number
  currentMusters: string[]
  holdArmyQuality: number | null
  holdCommand: MasterHoldValue['command'] | null
}
export interface MasterHoldValue {
  command: Extract<GameCommand, { type: 'move' | 'doneMove' }>
  heldLegionId: string
  expectedArmyQuality: number
  currentMusters: string[]
}
export interface MasterSearchResult {
  best: MasterCandidateValue | null
  candidates: MasterCandidateValue[]
  bestHold: MasterHoldValue | null
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
function landAndMuster(state: GameState, legion: Legion, hex: string, performMove: boolean): { state: GameState; legion: Legion; musters: string[] } {
  const next: GameState = { ...state, caretaker: { ...state.caretaker },
    legions: state.legions.map((l) => l.playerId === legion.playerId ? {
      ...l, creatures: l.creatures.map((c) => ({ ...c })),
      ...(l.id === legion.id ? { hexLabel: hex, moved: l.moved || performMove,
        recruited: performMove ? false : l.recruited,
        musteredThisTurn: performMove ? null : l.musteredThisTurn } : {}),
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
    expandedFutureMusters: 0, movementQueries: 0, generatedMoves: 0, futureRecruitCounts: {}, futureMustersByLegion: {}, futureHolds: 0, companionHoldMoves: 0, exhausted: false, incomplete: false, completeCandidates: 0, certifiedHoldEarlyExit: false }
  const result: MasterSearchResult = { best: null, candidates: [], bestHold: null, diagnostics }
  if (state.phase !== 'Move' || state.movementRoll == null) return result
  const owner = state.players[state.activePlayerIndex].id
  // Current unresolved battles require casualties/stock we deliberately do not invent.
  if (state.legions.some((l) => l.playerId === owner && enemyOn(state, l.hexLabel, owner))) return result
  const eligible = ranked.filter((m) => !m.forcedSplit && !enemyOn(state, m.hex, owner))
  // Keep the actual control first, then represent other legions before filling
  // remaining slots with alternate routes for an already represented legion.
  const diversified: ScoredMove[] = []
  const represented = new Set<string>()
  for (const move of eligible) {
    if (represented.has(move.legionId)) continue
    diversified.push(move)
    represented.add(move.legionId)
  }
  for (const move of eligible) if (!diversified.includes(move)) diversified.push(move)
  const shortlist = diversified.slice(0, limits.candidateLimit)
  const rootMovers = new Set(ranked.map((move) => move.legionId))
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
  function needsRecombination(position: GameState): boolean {
    const occupied = new Set<string>()
    for (const friend of position.legions.filter((l) => l.playerId === owner)) {
      if (occupied.has(friend.hexLabel)) return true
      occupied.add(friend.hexLabel)
    }
    return false
  }

  /** A HOLD is certified by the real end-movement predicate. When another
   * legion must move, project an actual noncombat leave and its shared-stock
   * muster; require that helper to survive and re-evaluate the held mover later.
   */
  function holdCertificate(position: GameState, mover: Legion, root: boolean): {
    certificate: { state: GameState; legion: Legion; musters: string[]; command: MasterHoldValue['command'] } | null
    alternativeMoves: boolean
  } {
    if (canEndMovePhase(position)) {
      // Done would recombine blocked stacks. Do not invent merged state here.
      if (needsRecombination(position)) return { certificate: null, alternativeMoves: false }
      return { certificate: { ...landAndMuster(position, mover, mover.hexLabel, false), command: { type: 'doneMove' } }, alternativeMoves: false }
    }
    let best: { state: GameState; legion: Legion; musters: string[]; command: MasterHoldValue['command']; quality: number; heldSurvival: number } | null = null
    let alternativeMoves = false
    for (const helper of position.legions) {
      if (helper.playerId !== owner || helper.id === mover.id || helper.moved || (root && !rootMovers.has(helper.id))) continue
      if (!movementQuery()) return { certificate: null, alternativeMoves }
      const frontier: { hex: string; teleport: boolean; rank: number }[] = []
      for (const [hex, info] of listAllMoves(position, helper, position.movementRoll!)) {
        if (diagnostics.generatedMoves >= limits.maxGeneratedMoves) { diagnostics.exhausted = true; return { certificate: null, alternativeMoves } }
        alternativeMoves = true
        diagnostics.generatedMoves++
        if (enemyOn(position, hex, owner)) continue
        const recruit = bestRecruitAt(position, helper, hex)
        frontier.push({ hex, teleport: info.teleport, rank: recruit ? scoreRecruitOption(position, recruit, hex, helper) : 0 })
      }
      for (const leave of frontier.sort((a, b) => b.rank - a.rank).slice(0, limits.destinationsPerRoll)) {
        const projected: GameState = { ...position,
          players: position.players.map((p) => p.id === owner && leave.teleport ? { ...p, hasTeleported: true } : p),
          legions: position.legions.map((l) => l.id === helper.id ? { ...l, hexLabel: leave.hex, moved: true, teleported: leave.teleport } : l) }
        if (!canEndMovePhase(projected) || needsRecombination(projected)) continue
        const grown = landAndMuster(projected, mover, mover.hexLabel, false)
        const movedHelper = grown.state.legions.find((l) => l.id === helper.id)!
        const helperSurvival = survival(grown.state, movedHelper)
        if (helperSurvival === null) return { certificate: null, alternativeMoves }
        if (helperSurvival < 1) continue // never credit a surviving helper sacrifice
        const heldSurvival = survival(grown.state, grown.legion)
        if (heldSurvival === null) return { certificate: null, alternativeMoves }
        const quality = armyQuality(grown.state, owner)
        if (!best || heldSurvival > best.heldSurvival || (heldSurvival === best.heldSurvival && quality > best.quality)) best = { ...grown, quality, heldSurvival,
          command: { type: 'move', legionId: helper.id, toHex: leave.hex, teleport: leave.teleport } }
      }
    }
    return { certificate: best, alternativeMoves }
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
    const readyState: GameState = { ...position, phase: 'Move',
      players: position.players.map((p) => p.id === owner ? { ...p, hasTeleported: false } : p),
      legions: position.legions.map((l) => l.playerId === owner ? { ...l,
        moved: false, recruited: false, teleported: false, musteredThisTurn: null, moveOriginHex: l.hexLabel } : l) }
    const ready = readyState.legions.find((l) => l.id === mover.id)!
    for (let roll = 1; roll <= 6; roll++) {
      if (!movementQuery()) return null
      const rolled: GameState = { ...readyState, movementRoll: roll }
      const legal = [...listAllMoves(rolled, ready, roll)]
      const frontier: { hex: string; rank: number }[] = []
      for (const [hex] of legal) {
        if (diagnostics.generatedMoves >= limits.maxGeneratedMoves ||
          reach.movementQueries + diagnostics.movementQueries > limits.maxMovementQueries) {
          diagnostics.exhausted = true
          return null
        }
        diagnostics.generatedMoves++
        if (enemyOn(rolled, hex, owner)) continue
        const recruit = bestRecruitAt(rolled, ready, hex)
        frontier.push({ hex, rank: recruit ? scoreRecruitOption(rolled, recruit, hex, ready) : 0 })
      }
      const choices = frontier.sort((a, b) => b.rank - a.rank).slice(0, limits.destinationsPerRoll)
        .map(({ hex }) => landAndMuster(rolled, ready, hex, true))
      const attempt = holdCertificate(rolled, ready, false)
      const hold = attempt.certificate
      if (diagnostics.exhausted) return null
      if (!hold && choices.length === 0 && attempt.alternativeMoves) {
        // Other legal moves exist but this bounded model did not certify one.
        // Do not pretend that the held legion must attack and die.
        diagnostics.incomplete = true
        return null
      }
      if (hold) {
        diagnostics.futureHolds++
        if (hold.command.type === 'move') diagnostics.companionHoldMoves++
        choices.push(hold)
      }
      let best = -Infinity
      if (choices.length === 0) {
        // No certified HOLD or noncombat continuation: no invented won battle.
        // Budget failure already returned; an unmodeled forced fight is a loss bound.
        best = canEndMovePhase(rolled) ? quality : deathValue
      }
      for (const choice of choices) {
        diagnostics.expandedFutureMusters += choice.musters.length
        for (const muster of choice.musters) {
          const legionId = muster.slice(0, muster.indexOf(':'))
          const type = muster.slice(muster.indexOf(':') + 1)
          diagnostics.futureMustersByLegion[legionId] = (diagnostics.futureMustersByLegion[legionId] ?? 0) + 1
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

  const holds = new Map<string, MasterHoldValue | null>()
  function rootHold(legion: Legion): MasterHoldValue | null {
    if (holds.has(legion.id)) return holds.get(legion.id)!
    const certificate = holdCertificate(state, legion, true).certificate
    if (!certificate) { holds.set(legion.id, null); return null }
    const value = visit(certificate.state, certificate.legion, limits.depth)
    if (value === null) return null
    const hold: MasterHoldValue = { command: certificate.command, heldLegionId: legion.id,
      expectedArmyQuality: value, currentMusters: certificate.musters }
    holds.set(legion.id, hold)
    if (!result.bestHold || value > result.bestHold.expectedArmyQuality) result.bestHold = hold
    return hold
  }

  for (const move of shortlist) {
    const legion = state.legions.find((l) => l.id === move.legionId)
    if (!legion || legion.playerId !== owner) throw new Error('Master lookahead move has no owned legion')
    if (!movementQuery()) { result.candidates = []; break }
    const legal = listAllMoves(state, legion, state.movementRoll).get(move.hex)
    if (!legal || legal.teleport !== move.teleport) throw new Error('Master lookahead received stale/illegal candidate')
    const grown = landAndMuster(state, legion, move.hex, true)
    if (needsRecombination(grown.state)) {
      // The ordinary root would still need a merge/separation before its turn
      // can finish. This local rollout does not invent that whole-player state.
      diagnostics.incomplete = true
      break
    }
    const value = visit(grown.state, grown.legion, limits.depth)
    if (value === null) { result.candidates = []; result.best = null; break }
    const hold = limits.compareHold ? rootHold(legion) : null
    if (diagnostics.exhausted || diagnostics.incomplete) { result.candidates = []; result.best = null; result.bestHold = null; break }
    const holdArmyQuality = hold?.expectedArmyQuality ?? null
    diagnostics.completeCandidates++
    result.candidates.push({ move, expectedArmyQuality: value,
      utility: (value - (holdArmyQuality ?? baseQuality)) * profile.recruitPreference + move.score * 0.1, currentMusters: grown.musters, holdArmyQuality, holdCommand: hold?.command ?? null })
    // The first root is the actual Normal control. A fully completed superior
    // legal HOLD is already a proven improvement; do not spend the remaining
    // budget on optional roots and then discard that completed comparison.
    if (limits.stopAfterHoldImprovement && result.candidates.length === 1 && hold && hold.expectedArmyQuality > value + 0.5) {
      diagnostics.certifiedHoldEarlyExit = true
      break
    }
  }
  if (limits.compareHold && limits.holdLegionId && !diagnostics.exhausted && !diagnostics.incomplete) {
    const held = state.legions.find((l) => l.id === limits.holdLegionId && l.playerId === owner && !l.moved)
    if (!held) throw new Error('Master HOLD has no unmoved owned legion')
    rootHold(held)
  }
  if (diagnostics.exhausted || diagnostics.incomplete) { result.candidates = []; result.best = null; result.bestHold = null }
  if (!diagnostics.exhausted && !diagnostics.incomplete) result.best = [...result.candidates].sort((a, b) => b.expectedArmyQuality - a.expectedArmyQuality || b.utility - a.utility)[0] ?? null
  diagnostics.movementQueries += reach.movementQueries
  return result
}
