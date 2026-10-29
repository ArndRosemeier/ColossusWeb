/** One bounded, deterministic HOLD-versus-split decision. No game-state mutation. */
import { listAllMoves, listMovePreview } from '../engine/movement'
import { compositionDevelopmentValue, intrinsicMusterValue, listRecruitOptionsAt, scoreRecruitOption } from '../engine/recruit'
import type { GameCommand, GameState, Legion } from '../engine/types'
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
  const parents = !parent.moved && parentHex === parent.hexLabel ? [none] : [none, ...growthOptions(state, parent, parentHex)]
  const children = !child.moved && childHex === child.hexLabel ? [none] : [none, ...growthOptions(state, child, childHex)]
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

type MoveCommand = Extract<GameCommand, { type: 'move' }>
type JointRoute = { steps: MoveCommand[]; parent: Legion; child: Legion; growth: number }
type SearchContext = { cache: SpatialCache; plans: number; queries: number; maxPlans: number; exhausted: boolean }

function positionRisk(state: GameState, legion: Legion, cache: SpatialCache): { safe: boolean; loss: number } {
  const pv = Math.max(1, legionPointValue(state, legion))
  let losingFight = false
  for (const enemy of state.legions) {
    if (enemy.playerId === legion.playerId || enemy.hexLabel !== legion.hexLabel) continue
    if (estimateBattleOutcome(state, legion, enemy, legion.hexLabel).ratio < 1.3) losingFight = true
  }
  const incoming = incomingThreatScore(state, legion, legion.hexLabel, cache)
  return { safe: !losingFight && incoming <= pv * 0.2,
    loss: incoming + (losingFight ? pv * (legion.creatures.some((c) => c.type === 'Titan') ? 1000 : 10) : 0) }
}

function safeAt(state: GameState, legion: Legion, hex: string, cache: SpatialCache): boolean {
  const ghost = { ...legion, hexLabel: hex }
  return positionRisk({ ...state, legions: state.legions.map((l) => l.id === ghost.id ? ghost : l) }, ghost, cache).safe
}

/** Projection follows an engine-provided move. Legal routes/teleport eligibility are
 * always recomputed after the first move, never inferred from two independent lists.
 */
function afterMove(state: GameState, legion: Legion, command: MoveCommand): GameState {
  const moved = { ...legion, hexLabel: command.toHex, moved: true, teleported: !!command.teleport }
  return { ...state, legions: state.legions.map((l) => l.id === legion.id ? moved : l),
    players: state.players.map((p) => p.id === legion.playerId && command.teleport ? { ...p, hasTeleported: true } : p) }
}

function routeChoices(state: GameState, piece: Legion, roll: number, limit: number, ctx: SearchContext): MoveCommand[] {
  if (piece.moved) return []
  ctx.queries++
  return [...listAllMoves(state, piece, roll)].map(([hex, info]) => ({ command:
    { type: 'move' as const, legionId: piece.id, toHex: hex, teleport: info.teleport },
    growth: Math.max(0, ...growthOptions(state, piece, hex).map((o) => o.value)) }))
    .sort((a, b) => b.growth - a.growth).slice(0, limit).map((o) => o.command)
}

/** Shared search for split approval AND execution/continuation. Moved pieces are fixed. */
function jointRoutes(state: GameState, parent: Legion, child: Legion, roll: number,
  limit: number, ctx: SearchContext,
): JointRoute[] {
  const routes: JointRoute[] = []
  const add = (projected: GameState, steps: MoveCommand[]) => {
    const p = projected.legions.find((l) => l.id === parent.id)!
    const c = projected.legions.find((l) => l.id === child.id)!
    if (p.hexLabel === c.hexLabel) return
    routes.push({ steps, parent: p, child: c,
      growth: jointSplitGrowth(state, parent, p.hexLabel, child, c.hexLabel) })
  }
  // Staying is a real option after the other piece has separated.
  add(state, [])
  for (const [first, second] of [[parent, child], [child, parent]]) {
    for (const command of routeChoices(state, first, roll, limit, ctx)) {
      const next = afterMove(state, first, command)
      add(next, [command])
      for (const continuation of routeChoices(next, second, roll, limit, ctx)) {
        add(afterMove(next, second, continuation), [command, continuation])
      }
    }
  }
  return routes.sort((a, b) => b.growth - a.growth || a.steps.length - b.steps.length)
}

function routeRisk(state: GameState, route: JointRoute, ctx: SearchContext): { safe: boolean; loss: number } {
  const projected = { ...state, legions: state.legions.map((l) =>
    l.id === route.parent.id ? route.parent : l.id === route.child.id ? route.child : l) }
  const parentRisk = positionRisk(projected, route.parent, ctx.cache)
  const childRisk = positionRisk(projected, route.child, ctx.cache)
  return { safe: parentRisk.safe && childRisk.safe, loss: parentRisk.loss + childRisk.loss }
}

function safeJointRoute(state: GameState, parent: Legion, child: Legion, roll: number,
  limit: number, ctx: SearchContext,
): JointRoute | null {
  for (const route of jointRoutes(state, parent, child, roll, limit, ctx)) {
    if (ctx.plans >= ctx.maxPlans) { ctx.exhausted = true; return null }
    ctx.plans++
    if (routeRisk(state, route, ctx).safe) return route
  }
  return null
}

/** Existing moveOriginHex survives beginMovePhase clearing splitParentId. */
function splitMoveGroups(state: GameState): Legion[][] {
  const owner = state.players[state.activePlayerIndex].id
  const groups = new Map<string, Legion[]>()
  for (const legion of state.legions.filter((l) => l.playerId === owner)) {
    const key = legion.moveOriginHex ?? legion.hexLabel
    const group = groups.get(key) ?? []
    group.push(legion)
    groups.set(key, group)
  }
  return [...groups.values()].filter((group) => group.length === 2 && group.some((l) => !l.moved))
    .sort((a, b) => Number(b[0].hexLabel === b[1].hexLabel) - Number(a[0].hexLabel === a[1].hexLabel))
}

export interface SplitMovePolicy {
  command: MoveCommand | null
  heldLegionIds: string[]
  status: 'none' | 'safe' | 'least-loss'
}

/** No hidden saved plan: recompute from actual occupancy, actual roll and used teleport.
 * An already-moved sibling is fixed; safe HOLDs are excluded from later generic RNG.
 * Changed-state/forced-opening failure is explicit: least-loss evaluated LEGAL route,
 * with Titan loss dominating growth. It is not falsely labeled a safe continuation.
 */
export function splitMovePolicy(state: GameState, budget: SplitPlanningBudget = {}): SplitMovePolicy {
  const result: SplitMovePolicy = { command: null, heldLegionIds: [], status: 'none' }
  if (state.phase !== 'Move' || state.movementRoll == null) return result
  const limits = planningLimits(budget)
  const groups = splitMoveGroups(state)
  if (groups.length === 0) return result
  const ctx: SearchContext = { cache: buildSpatialCache(state), plans: 0, queries: 0,
    maxPlans: limits.maxPlans, exhausted: false }
  for (const group of groups) {
    const route = safeJointRoute(state, group[0], group[1], state.movementRoll, limits.destinations, ctx)
    if (route) {
      result.status = 'safe'
      if (route.steps.length) { result.command = route.steps[0]; return result }
      result.heldLegionIds.push(...group.filter((l) => !l.moved).map((l) => l.id))
      continue
    }
    // Evaluate every legal single leave as well: a bounded growth beam must not
    // produce illegal Done while an unseparated group can walk. No engine delay.
    const fallback = jointRoutes(state, group[0], group[1], state.movementRoll, limits.destinations, ctx)
    for (const first of group.filter((l) => !l.moved)) {
      const second = group.find((l) => l.id !== first.id)!
      for (const command of routeChoices(state, first, state.movementRoll, Infinity, ctx)) {
        const projected = afterMove(state, first, command)
        const moved = projected.legions.find((l) => l.id === first.id)!
        if (moved.hexLabel === second.hexLabel) continue
        fallback.push({ steps: [command], parent: first.id === group[0].id ? moved : second,
          child: first.id === group[0].id ? second : moved, growth: 0 })
      }
    }
    const scoredFallback = fallback.map((route) => ({ route, loss: routeRisk(state, route, ctx).loss }))
      .sort((a, b) => a.loss - b.loss || b.route.growth - a.route.growth)
    const leastLoss = scoredFallback[0]?.route
    result.status = 'least-loss'
    if (leastLoss?.steps.length) { result.command = leastLoss.steps[0]; return result }
    result.heldLegionIds.push(...group.filter((l) => !l.moved).map((l) => l.id))
  }
  return result
}

function planningLimits(budget: SplitPlanningBudget): { maxPlans: number; destinations: number } {
  const maxPlans = budget.maxPlans ?? 1024
  const destinations = budget.destinationsPerRoll ?? 4
  if (!Number.isInteger(maxPlans) || maxPlans < 1 || maxPlans > 8192 ||
    !Number.isInteger(destinations) || destinations < 1 || destinations > 12) {
    throw new Error('Invalid split planning budget')
  }
  return { maxPlans, destinations }
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
  const { maxPlans, destinations } = planningLimits(budget)
  const result: SplitPlan = { childCreatures: null, score: 0, holdScore: 0,
    candidates: 0, plans: 0, exhausted: false, movementQueries: 0 }
  if (legion.creatures.length !== 7 || legion.splitThisTurn || state.turnNumber === 1) return result
  for (const c of legion.creatures) {
    if (!state.variant.creatures[c.type]) throw new Error(`Unknown split creature: ${c.type}`)
  }
  const cache = buildSpatialCache(state)
  const ctx: SearchContext = { cache, plans: 0, queries: 0, maxPlans, exhausted: false }
  // HOLD retains the original composition and may stay while another legion moves.
  // Only actual legal endpoints compete with that baseline, never imaginary open exits.
  for (let roll = 1; roll <= 6; roll++) {
    let risk = incomingThreatScore(state, legion, legion.hexLabel, cache)
    for (const [hex] of listMovePreview(state, legion, roll)) {
      if (safeAt(state, legion, hex, cache)) { risk = 0; break }
    }
    ctx.queries++
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
    const split = { ...pairState(state, parent, child), players: state.players.map((p) =>
      p.id === parent.playerId ? { ...p, hasTeleported: false } : p) }
    let growth = 0
    let complete = true
    for (let roll = 1; roll <= 6; roll++) {
      const route = safeJointRoute(split, parent, child, roll, destinations, ctx)
      if (!route) { complete = false; break }
      growth += route.growth / 6
    }
    if (ctx.exhausted) break
    if (!complete || growth <= 0) continue
    const developmentLoss = Math.max(0, originalDevelopment -
      compositionDevelopmentValue(state, counts(parent)) - compositionDevelopmentValue(state, counts(child)))
    const investment = childTypes.reduce((sum, type) => sum + intrinsicMusterValue(state, type), 0)
    const score = growth * profile.recruitPreference - developmentLoss * 1.5 - investment * 0.15
    if (score > result.score + 1) { result.score = score; result.childCreatures = childTypes }
  }
  result.plans = ctx.plans
  result.exhausted = ctx.exhausted
  result.movementQueries = cache.movementQueries + ctx.queries
  return result
}
