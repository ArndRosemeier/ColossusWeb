import { legalBattleMovesFor } from '../engine/battle'
import { isUnitAlive } from '../engine/battleStrike'
import type { BattleState, BattleUnit, GameCommand, GameState } from '../engine/types'

type EntryCommand = Extract<GameCommand, { type: 'battleMove' }>
export interface BattleDeploymentOptions { beamWidth: number; maxNodes: number; maxResponseNodes: number }
export const HARD_BATTLE_DEPLOYMENT: Readonly<BattleDeploymentOptions> = Object.freeze({ beamWidth: 6, maxNodes: 2000, maxResponseNodes: 4096 })
export interface DeploymentWork {
  nodes: number; legalQueries: number; completeFormations: number; responseNodes: number; entrySafetyChecks: number
  baselineMoves: number; reachedDepth: number; exhausted: boolean; usedPlan: boolean; changedDecision: boolean
  reason: 'complete' | 'budget' | 'unsupported' | 'baseline' | 'no-improvement'
}
export interface DeploymentResult {
  command: GameCommand; work: DeploymentWork; plan: EntryCommand[]; baselinePlan: EntryCommand[]
  score: number | null; baselineScore: number | null
}
interface FormationValue { score: number; titanRisk: number; complete: boolean }
interface DeploymentPolicy {
  /** Exact existing Normal entry picker with a local deterministic tie breaker. */
  normal: (battle: BattleState) => GameCommand
  placementScore: (unitId: string, hex: string) => number
  formationScore: (battle: BattleState) => number
  completeScore: (battle: BattleState, budget: { nodes: number; limit: number }) => FormationValue
  /** Shared mandatory entry guard, not a second feasibility implementation. */
  canFinishAfter: (command: EntryCommand) => boolean
}
export function deploymentOptions(options: Partial<BattleDeploymentOptions> = {}): BattleDeploymentOptions {
  const result = { ...HARD_BATTLE_DEPLOYMENT, ...options }
  for (const [key, max] of [['beamWidth', 12], ['maxNodes', 4000], ['maxResponseNodes', 16384]] as const) {
    if (!Number.isInteger(result[key]) || result[key] < 1 || result[key] > max) throw new Error(`Invalid battle deployment ${key}`)
  }
  return result
}
const clone = (battle: BattleState): BattleState => ({ ...battle, units: battle.units.map(unit => ({ ...unit })), moveStack: [...battle.moveStack] })
function pending(state: GameState, battle: BattleState): BattleUnit[] {
  return battle.units.filter(unit => unit.playerId === battle.activePlayerId && !unit.hex && !unit.moved && isUnitAlive(state, unit))
}
function land(battle: BattleState, command: EntryCommand): BattleState {
  const next = clone(battle), mover = next.units.find(unit => unit.id === command.unitId)!
  mover.hex = command.toHex; mover.moved = true; next.moveStack.push(mover.id)
  return next
}

/** Complete legal entry sequences only. No phase advance, dice, global IDs or caller mutation.
 * Callbacks keep the existing placement/formation/response model in evaluateBattle,
 * without a cyclic dependency or a second creature-strength formula.
 */
export function searchBattleDeployment(state: GameState, battle: BattleState, control: GameCommand,
  policy: DeploymentPolicy, overrides: Partial<BattleDeploymentOptions> = {}): DeploymentResult {
  const limits = deploymentOptions(overrides), firstHalf = battle.activeHalf === 'attacker' ? !battle.firstManeuverDone.attacker : !battle.firstManeuverDone.defender
  const work: DeploymentWork = { nodes: 0, legalQueries: 0, completeFormations: 0, responseNodes: 0, entrySafetyChecks: 0, baselineMoves: 0,
    reachedDepth: 0, exhausted: false, usedPlan: false, changedDecision: false, reason: 'unsupported' }
  const result: DeploymentResult = { command: control, work, plan: [], baselinePlan: [], score: null, baselineScore: null }
  const count = pending(state, battle).length
  if (battle.phase !== 'Move' || !firstHalf || count < 1 || count > 7 || control.type !== 'battleMove') return result
  const response = { nodes: 0, limit: limits.maxResponseNodes }
  function budget() {
    if (work.nodes >= limits.maxNodes) { work.exhausted = true; work.reason = 'budget'; return false }
    work.nodes++; return true
  }
  // The actual RNG-selected Normal root is always the first baseline action.
  let normal = clone(battle), command: GameCommand = control
  for (let depth = 0; depth < count; depth++) {
    if (!budget()) return result
    const entry = command.type === 'battleMove' ? command : null
    const unit = entry ? pending(state, normal).find(unit => unit.id === entry.unitId) : undefined
    work.legalQueries++
    if (!unit || !entry || !legalBattleMovesFor(state, normal, unit).includes(entry.toHex)) { work.reason = 'baseline'; return result }
    result.baselinePlan.push(entry)
    normal = land(normal, entry); work.baselineMoves++
    if (depth + 1 < count) command = policy.normal(normal)
  }
  const base = policy.completeScore(normal, response)
  work.responseNodes = response.nodes; work.completeFormations++
  if (!base.complete) { work.exhausted = true; work.reason = 'budget'; return result }
  result.baselineScore = base.score
  type Node = { battle: BattleState; plan: EntryCommand[]; placement: number; score: number }
  let beam: Node[] = [{ battle: clone(battle), plan: [], placement: 0, score: 0 }]
  for (let depth = 0; depth < count; depth++) {
    const children = new Map<string, Node>()
    for (const node of beam) for (const unit of pending(state, node.battle)) {
      work.legalQueries++
      for (const toHex of legalBattleMovesFor(state, node.battle, unit)) {
        if (!budget()) return result
        const placement = node.placement + policy.placementScore(unit.id, toHex)
        if (!Number.isFinite(placement)) continue
        const move: EntryCommand = { type: 'battleMove', unitId: unit.id, toHex }
        const next = land(node.battle, move)
        const key = next.units.filter(unit => unit.playerId === battle.activePlayerId).map(unit => `${unit.id}:${unit.hex}`).join('|')
        if (children.has(key)) continue // Same placements through another legal entry order.
        const score = placement + policy.formationScore(next)
        children.set(key, { battle: next, plan: [...node.plan, move], placement, score })
      }
    }
    beam = [...children.values()].sort((a, b) => b.score - a.score).slice(0, limits.beamWidth)
    work.reachedDepth = depth + 1
    if (beam.length === 0) { work.reason = 'no-improvement'; return result }
  }
  let best = base.score, bestPlan = result.baselinePlan
  for (const node of beam) {
    const value = policy.completeScore(node.battle, response)
    work.responseNodes = response.nodes; work.completeFormations++
    if (!value.complete) { work.exhausted = true; work.reason = 'budget'; return result }
    if (value.titanRisk <= base.titanRisk + 1e-9 && value.score > best + 0.5) {
      work.entrySafetyChecks++
      if (policy.canFinishAfter(node.plan[0])) { best = value.score; bestPlan = node.plan }
    }
  }
  work.usedPlan = true; work.reason = 'complete'
  result.score = best; result.plan = bestPlan
  if (bestPlan !== result.baselinePlan) {
    result.command = bestPlan[0]
    work.changedDecision = JSON.stringify(result.command) !== JSON.stringify(control)
  }
  return result
}
