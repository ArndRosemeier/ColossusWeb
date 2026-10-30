import { legalBattleMovesFor } from '../engine/battle'
import { isUnitAlive } from '../engine/battleStrike'
import type { BattleState, GameCommand, GameState } from '../engine/types'
import type { BattleRolloutWork } from './battleRollout'
import { checkedFormationBudget, cloneFormation, formationBeam, formationId, projectFormationMove, type FormationBeamWork, type FormationMove } from './battleFormation'

export interface WholeManeuverOptions {
  beamWidth: number; maxNodes: number; destinationsPerUnit: number; maxDestinationEvaluations: number; maxResponseNodes: number
}
export const HARD_WHOLE_MANEUVER: Readonly<WholeManeuverOptions> = Object.freeze({ beamWidth: 8, maxNodes: 1200,
  destinationsPerUnit: 3, maxDestinationEvaluations: 6000, maxResponseNodes: 4096 })
export function wholeManeuverOptions(options: Partial<WholeManeuverOptions> = {}): WholeManeuverOptions {
  return checkedFormationBudget({ ...HARD_WHOLE_MANEUVER, ...options },
    ['beamWidth', 'maxNodes', 'destinationsPerUnit', 'maxDestinationEvaluations', 'maxResponseNodes'], 'whole maneuver')
}
export interface WholeManeuverWork extends FormationBeamWork {
  priorEvaluations: number
  baselineMoves: number; baselineResponseNodes: number; baselineSafetyNodes: number
  completeFormations: number; responseNodes: number; usedPlan: boolean; changedDecision: boolean
  reason: 'complete' | 'unsupported' | 'baseline' | 'budget' | 'boundary' | 'insufficient'
}
export interface WholeManeuverResult {
  command: GameCommand; plan: FormationMove[]; baselinePlan: FormationMove[]; held: string[]; work: WholeManeuverWork
  rollout?: BattleRolloutWork
}
export interface ManeuverFormation { id: string; battle: BattleState; plan: FormationMove[]; held: string[]; score: number }
interface WholeManeuverPolicy {
  normal: (battle: BattleState) => { command: GameCommand; responseNodes: number; safetyNodes: number }
  placementScore: (unitId: string, hex: string) => number
  formationScore: (battle: BattleState) => number
  completeScore: (battle: BattleState, budget: { nodes: number; limit: number }) => { score: number; titanRisk: number; complete: boolean }
  compare: (formations: ManeuverFormation[]) => { rootId: string; work: BattleRolloutWork }
}

/** Normal continuation + bounded complete Move/HOLD plans, using the SAME formation
 * projection/beam and sampled acceptance seam as initial deployment. No fake HOLD
 * command, dispatch, recursive Hard, world RNG, persistent plan or input mutation.
 */
export function searchWholeManeuver(state: GameState, battle: BattleState, control: GameCommand,
  policy: WholeManeuverPolicy, options: Partial<WholeManeuverOptions> = {}): WholeManeuverResult {
  const limits = wholeManeuverOptions(options)
  const work: WholeManeuverWork = { nodes: 0, legalQueries: 0, destinationEvaluations: 0, priorEvaluations: 0, reachedDepth: 0, exhausted: false,
    baselineMoves: 0, baselineResponseNodes: 0, baselineSafetyNodes: 0, completeFormations: 0, responseNodes: 0,
    usedPlan: false, changedDecision: false, reason: 'unsupported' }
  const result: WholeManeuverResult = { command: control, plan: [], baselinePlan: [], held: [], work }
  const ids = battle.units.filter(unit => unit.playerId === battle.activePlayerId && !unit.moved && unit.hex && isUnitAlive(state, unit)).map(unit => unit.id)
  if (battle.phase !== 'Move' || ids.length > 7 || battle.units.some(unit => !unit.hex && isUnitAlive(state, unit)) ||
    !battle.firstManeuverDone.attacker || !battle.firstManeuverDone.defender) return result
  let normal = cloneFormation(battle), command = control
  for (;;) {
    if (command.type === 'battleDonePhase') break
    if (work.nodes >= limits.maxNodes) { work.exhausted = true; work.reason = 'budget'; return result }
    work.nodes++; work.legalQueries++
    const step = command.type === 'battleMove' ? command : null
    const mover = step ? normal.units.find(unit => unit.id === step.unitId) : undefined
    if (command.type !== 'battleMove' || !mover || mover.playerId !== battle.activePlayerId || mover.moved ||
      !legalBattleMovesFor(state, normal, mover).includes(command.toHex)) { work.reason = 'baseline'; return result }
    result.baselinePlan.push(command); work.baselineMoves++
    normal = projectFormationMove(normal, command)
    const next = policy.normal(normal)
    work.baselineResponseNodes += next.responseNodes; work.baselineSafetyNodes += next.safetyNodes; command = next.command
  }
  const budget = { nodes: 0, limit: limits.maxResponseNodes }, base = policy.completeScore(normal, budget)
  result.held = ids.filter(id => !normal.units.find(unit => unit.id === id)!.moved)
  work.completeFormations++; work.responseNodes = budget.nodes
  if (!base.complete) { work.exhausted = true; work.reason = 'budget'; return result }
  const beam = formationBeam(state, battle, ids, { ...limits, diversifyFirstMoves: true }, {
    allowHold: true,
    placementScore: (id, hex) => policy.placementScore(id, hex) - policy.placementScore(id, battle.units.find(unit => unit.id === id)!.hex!),
    formationScore: policy.formationScore,
  }, work)
  if (work.exhausted) { work.reason = 'budget'; return result }
  const formations: ManeuverFormation[] = [{ id: formationId(normal), battle: normal, plan: result.baselinePlan,
    held: ids.filter(id => !normal.units.find(unit => unit.id === id)!.moved), score: base.score }]
  for (const node of beam) {
    if (formations.some(formation => formation.id === formationId(node.battle))) continue
    const value = policy.completeScore(node.battle, budget)
    work.completeFormations++; work.responseNodes = budget.nodes
    if (!value.complete) { work.exhausted = true; work.reason = 'budget'; return result }
    if (Number.isFinite(value.score) && value.titanRisk <= base.titanRisk + 1e-9) formations.push({
      id: formationId(node.battle), battle: node.battle, plan: node.plan, held: node.held, score: value.score })
  }
  const compared = policy.compare([formations[0], ...formations.slice(1).sort((a, b) => b.score - a.score)])
  result.rollout = compared.work; work.exhausted = compared.work.exhausted
  if (!compared.work.usedRollout) { work.reason = compared.work.reason === 'boundary' ? 'boundary' : work.exhausted ? 'budget' : 'insufficient'; return result }
  const selected = formations.find(formation => formation.id === compared.rootId)
  if (!selected) throw new Error('Outcome comparison selected an unknown maneuver formation')
  result.plan = selected.plan; result.held = selected.held; result.command = selected.plan[0] ?? { type: 'battleDonePhase' }
  work.usedPlan = true; work.changedDecision = compared.work.changedDecision; work.reason = 'complete'
  return result
}
