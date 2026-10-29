import { listRecruitOptionsAt } from '../engine/recruit'
import type { GameState, Legion } from '../engine/types'

/** Movement-target illustration only. Eligibility is engine-owned; AI, Enter
 * and current-hex muster keep their separate strategic development scorer. */
export function movementRecruitPreview(state: GameState, legion: Legion, hexLabel: string): string | null {
  let best: string | null = null
  let bestScore = -Infinity, bestSkill = -Infinity
  for (const name of listRecruitOptionsAt(state, legion, hexLabel)) {
    const creature = state.variant.creatures[name]
    if (!creature || !Number.isFinite(creature.power) || !Number.isFinite(creature.skill)
      || typeof creature.flies !== 'boolean' || typeof creature.rangestrikes !== 'boolean') {
      throw Error(`Invalid movement recruit preview data for ${name}.`)
    }
    const score = creature.power * creature.skill + Number(creature.flies) + Number(creature.rangestrikes)
    if (!Number.isFinite(score)) throw Error(`Invalid movement recruit preview score for ${name}.`)
    if (score > bestScore || (score === bestScore && creature.skill > bestSkill)) {
      best = name; bestScore = score; bestSkill = creature.skill
    }
  }
  return best
}
