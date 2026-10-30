import { legalBattleMovesFor } from '../engine/battle'
import type { BattleState, GameCommand, GameState } from '../engine/types'

export type FormationMove = Extract<GameCommand, { type: 'battleMove' }>
export interface FormationBeamWork {
  nodes: number; legalQueries: number; destinationEvaluations: number; reachedDepth: number; exhausted: boolean
}
export interface FormationNode {
  battle: BattleState; plan: FormationMove[]; remaining: string[]; held: string[]; placement: number; score: number
}
const BUDGET_MAX = { beamWidth: 12, maxNodes: 4000, destinationsPerUnit: 6, maxDestinationEvaluations: 12000, maxResponseNodes: 16384 } as const
export function checkedFormationBudget<T extends object>(options: T, keys: readonly (keyof typeof BUDGET_MAX)[], label: string): T {
  for (const key of keys) {
    const value = (options as Record<string, unknown>)[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > BUDGET_MAX[key]) throw new Error(`Invalid ${label} ${key}`)
  }
  return options
}
export const cloneFormation = (battle: BattleState): BattleState => ({ ...battle,
  units: battle.units.map(unit => ({ ...unit })), moveStack: [...battle.moveStack] })
export function projectFormationMove(battle: BattleState, command: FormationMove): BattleState {
  const next = cloneFormation(battle), mover = next.units.find(unit => unit.id === command.unitId)!
  mover.hex = command.toHex; mover.moved = true; next.moveStack.push(mover.id)
  return next
}
export const formationId = (battle: BattleState) => battle.units.map(unit => `${unit.id}:${unit.hex}`).join('|')

/** Entry and ordinary maneuver share ONE bounded projection/beam seam. HOLD is
 * internal bookkeeping, not an engine move or a fictitious moved flag.
 */
export function formationBeam(state: GameState, battle: BattleState, unitIds: string[],
  limits: { beamWidth: number; maxNodes: number; destinationsPerUnit?: number; maxDestinationEvaluations?: number; diversifyFirstMoves?: boolean },
  policy: { allowHold: boolean; placementScore: (unitId: string, hex: string) => number; formationScore: (battle: BattleState) => number },
  work: FormationBeamWork): FormationNode[] {
  let beam: FormationNode[] = [{ battle: cloneFormation(battle), plan: [], remaining: unitIds, held: [], placement: 0, score: 0 }]
  const scores = new Map<string, number>()
  for (let depth = 0; depth < unitIds.length; depth++) {
    const children = new Map<string, FormationNode>()
    for (const node of beam) for (const unitId of node.remaining) {
      const unit = node.battle.units.find(unit => unit.id === unitId)!
      work.legalQueries++
      let moves: { hex: string; score: number }[] = []
      for (const hex of legalBattleMovesFor(state, node.battle, unit)) {
        if (work.destinationEvaluations >= (limits.maxDestinationEvaluations ?? 12000)) { work.exhausted = true; return [] }
        work.destinationEvaluations++
        moves.push({ hex, score: policy.placementScore(unitId, hex) })
      }
      if (limits.destinationsPerUnit !== undefined) moves = moves.sort((a, b) => b.score - a.score).slice(0, limits.destinationsPerUnit)
      const choices: { hex: string | null; score: number }[] = [...(policy.allowHold ? [{ hex: null, score: 0 }] : []), ...moves]
      for (const { hex: toHex, score } of choices) {
        if (work.nodes >= limits.maxNodes) { work.exhausted = true; return [] }
        work.nodes++
        const placement = node.placement + score
        if (!Number.isFinite(placement)) continue
        const command: FormationMove | null = toHex ? { type: 'battleMove', unitId, toHex } : null
        const next = command ? projectFormationMove(node.battle, command) : node.battle
        const remaining = node.remaining.filter(id => id !== unitId), held = command ? node.held : [...node.held, unitId]
        // Same positions but different remaining/held units have different legal
        // continuations; they MUST NOT alias during ordinary maneuver planning.
        const key = formationId(next) + '/' + remaining.join(',') + '/' + [...held].sort().join(',')
        if (children.has(key)) continue
        const pose = formationId(next)
        if (!scores.has(pose)) scores.set(pose, policy.formationScore(next))
        children.set(key, { battle: next, plan: command ? [...node.plan, command] : node.plan,
          remaining, held, placement, score: placement + scores.get(pose)! })
      }
    }
    const ranked = [...children.values()].sort((a, b) => b.score - a.score)
    if (limits.diversifyFirstMoves) {
      const represented = new Set<string>(), diverse: FormationNode[] = []
      for (const node of ranked) {
        const key = node.plan[0]?.unitId ?? 'hold'
        if (!represented.has(key)) { represented.add(key); diverse.push(node) }
      }
      beam = [...diverse, ...ranked.filter(node => !diverse.includes(node))].slice(0, limits.beamWidth)
    } else beam = ranked.slice(0, limits.beamWidth)
    work.reachedDepth = depth + 1
    if (beam.length === 0) break
  }
  return beam
}
