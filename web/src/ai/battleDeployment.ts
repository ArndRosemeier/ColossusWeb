import { legalBattleMovesFor } from '../engine/battle'
import { isUnitAlive } from '../engine/battleStrike'
import type { BattleState, BattleUnit, GameCommand, GameState } from '../engine/types'
import type { BattleRolloutWork } from './battleRollout'
import { cloneFormation as clone, projectFormationMove as land, formationId, formationBeam, checkedFormationBudget } from './battleFormation'

type EntryCommand = Extract<GameCommand, { type: 'battleMove' }>
export interface BattleDeploymentOptions { beamWidth: number; maxNodes: number; maxResponseNodes: number }
export const HARD_BATTLE_DEPLOYMENT: Readonly<BattleDeploymentOptions> = Object.freeze({ beamWidth: 6, maxNodes: 2000, maxResponseNodes: 4096 })
export interface DeploymentWork {
  nodes: number; legalQueries: number; destinationEvaluations: number; completeFormations: number; responseNodes: number; entrySafetyChecks: number
  baselineMoves: number; reachedDepth: number; exhausted: boolean; usedPlan: boolean; changedDecision: boolean
  mandatorySafety: 'not-needed' | 'certified' | 'unavailable'
  reason: 'complete' | 'mandatory-safety' | 'safety-not-needed' | 'budget' | 'boundary' | 'insufficient' | 'unsupported' | 'baseline' | 'no-improvement'
}
export interface DeploymentResult {
  command: GameCommand; work: DeploymentWork; plan: EntryCommand[]; baselinePlan: EntryCommand[]
  score: number | null; baselineScore: number | null
  rollout?: BattleRolloutWork
  mandatoryWork?: DeploymentWork
}
interface FormationValue { score: number; titanRisk: number; complete: boolean }
export interface DeploymentFormation { id: string; battle: BattleState; plan: EntryCommand[]; score: number }
interface DeploymentPolicy {
  /** Exact existing Normal entry picker with a local deterministic tie breaker. */
  normal: (battle: BattleState) => GameCommand
  placementScore: (unitId: string, hex: string) => number
  formationScore: (battle: BattleState) => number
  completeScore: (battle: BattleState, budget: { nodes: number; limit: number }) => FormationValue
  /** Shared mandatory entry guard, not a second feasibility implementation. */
  canFinishAfter: (command: EntryCommand) => boolean
  compare: (formations: DeploymentFormation[]) => { rootId: string; work: BattleRolloutWork }
  guaranteedTitanLoss: (battle: BattleState) => boolean
}
export function deploymentOptions(options: Partial<BattleDeploymentOptions> = {}): BattleDeploymentOptions {
  return checkedFormationBudget({ ...HARD_BATTLE_DEPLOYMENT, ...options }, ['beamWidth', 'maxNodes', 'maxResponseNodes'], 'battle deployment')
}
function pending(state: GameState, battle: BattleState): BattleUnit[] {
  return battle.units.filter(unit => unit.playerId === battle.activePlayerId && !unit.hex && !unit.moved && isUnitAlive(state, unit))
}
/** Complete legal entry sequences only. No phase advance, dice, global IDs or caller mutation.
 * Callbacks keep the existing placement/formation/response model in evaluateBattle,
 * without a cyclic dependency or a second creature-strength formula.
 */
export function searchBattleDeployment(state: GameState, battle: BattleState, control: GameCommand,
  policy: DeploymentPolicy, overrides: Partial<BattleDeploymentOptions> = {}, mode: 'outcomes' | 'mandatory-safety' = 'outcomes'): DeploymentResult {
  const limits = deploymentOptions(overrides), firstHalf = battle.activeHalf === 'attacker' ? !battle.firstManeuverDone.attacker : !battle.firstManeuverDone.defender
  const work: DeploymentWork = { nodes: 0, legalQueries: 0, destinationEvaluations: 0, completeFormations: 0, responseNodes: 0, entrySafetyChecks: 0, baselineMoves: 0,
    reachedDepth: 0, exhausted: false, usedPlan: false, changedDecision: false, mandatorySafety: mode === 'mandatory-safety' ? 'unavailable' : 'not-needed', reason: 'unsupported' }
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
  if (mode === 'mandatory-safety') {
    if (!policy.guaranteedTitanLoss(normal)) { work.mandatorySafety = 'not-needed'; work.reason = 'safety-not-needed'; return result }
    work.mandatorySafety = 'unavailable'
  }
  const base = mode === 'mandatory-safety' ? { score: 0, titanRisk: 0, complete: true } : policy.completeScore(normal, response)
  work.responseNodes = response.nodes; work.completeFormations++
  if (!base.complete) { work.exhausted = true; work.reason = 'budget'; return result }
  result.baselineScore = mode === 'mandatory-safety' ? null : base.score
  const beam = formationBeam(state, battle, pending(state, battle).map(unit => unit.id), limits,
    { allowHold: false, placementScore: policy.placementScore, formationScore: policy.formationScore }, work)
  if (work.exhausted) { work.reason = 'budget'; return result }
  if (beam.length === 0) { work.reason = 'no-improvement'; return result }
  const formations: DeploymentFormation[] = [{ id: formationId(normal), battle: normal, plan: result.baselinePlan, score: base.score }]
  for (const node of beam) {
    const value = mode === 'mandatory-safety' ? { score: policy.guaranteedTitanLoss(node.battle) ? -Infinity : node.score, titanRisk: 0, complete: true } : policy.completeScore(node.battle, response)
    work.responseNodes = response.nodes; work.completeFormations++
    if (!value.complete) { work.exhausted = true; work.reason = 'budget'; return result }
    if (Number.isFinite(value.score) && value.titanRisk <= base.titanRisk + 1e-9 && !formations.some(formation => formation.id === formationId(node.battle))) {
      work.entrySafetyChecks++
      if (policy.canFinishAfter(node.plan[0])) formations.push({ id: formationId(node.battle), battle: node.battle, plan: node.plan, score: value.score })
    }
  }
  if (mode === 'mandatory-safety') {
    const safe = formations.slice(1).sort((a, b) => b.score - a.score)[0]
    if (!safe) { work.reason = 'no-improvement'; return result }
    work.usedPlan = true; work.mandatorySafety = 'certified'; work.reason = 'mandatory-safety'
    result.command = safe.plan[0]; result.plan = safe.plan; result.score = safe.score
    work.changedDecision = JSON.stringify(result.command) !== JSON.stringify(control)
    return result
  }
  // Static utility orders the shortlist; only completed sampled outcomes may
  // change the live action. The exact Normal formation always remains root zero.
  const comparison = policy.compare([formations[0], ...formations.slice(1).sort((a, b) => b.score - a.score)])
  result.rollout = comparison.work
  work.exhausted = comparison.work.exhausted
  if (!comparison.work.usedRollout) { work.reason = comparison.work.reason === 'boundary' ? 'boundary' : comparison.work.exhausted ? 'budget' : 'insufficient'; return result }
  const selected = formations.find(formation => formation.id === comparison.rootId)
  if (!selected) throw new Error('Outcome comparison selected an unknown deployment formation')
  work.usedPlan = true; work.reason = 'complete'; work.changedDecision = comparison.work.changedDecision
  result.score = selected.score; result.plan = selected.plan; result.command = selected.plan[0]
  return result
}
